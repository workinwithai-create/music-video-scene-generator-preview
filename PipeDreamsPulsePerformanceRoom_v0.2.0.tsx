'use client';

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PipeDreamsCharacter } from './PipeDreamsCharacterCreator_v0.2.0';
import type { PulseLive } from './PulseAvatar_v0.2.0';
import { PulseAudio } from './pulseAudio_v0.2.0';
import { loadPoseTracker } from './poseTracker_v0.2.0';
import {
  BodyTracker, CUES, SKELETON_LINES, bodyFromZones, buildCueOrder, clamp, cueStrength, gradeOf, restBody, scoreCue, zoneThreshold,
  type BodyState, type CueDefinition, type Grade, type Landmark, type MotionZone, type TrackingSource, type ZoneEnergy,
} from './pulseTracking_v0.2.0';

/**
 * PULSE v0.2.0 — camera performance room for Pipe Dreams Studio.
 *
 * What changed from v0.1.2:
 *  - Real body tracking (MediaPipe pose, on the device). Your 3D character copies your arms, lean,
 *    step, duck and legs like a mirror, and each move is judged by its shape, not by pixels changing.
 *    If tracking cannot load or cannot see you, it falls back to the v0.1 motion-zone check.
 *  - Sound: a click track with a four-beat count-in, plus hit and miss sounds.
 *  - A run now has a length and ends on a results card.
 *  - Three modes that actually differ: Game (follow the moves), Director (it records the moves you
 *    choose to do), Free play (no scoring).
 *  - Pipe Dreams Studio look, laid out for a phone first.
 *
 * The event contract is unchanged (schema `pipe-dreams.pulse.motion-events`); v0.2.0 only adds
 * the optional `tracking` field to each event.
 */
export const PULSE_VERSION = '0.2.0';

// Same key the My Character editor saves under. Repeated here (not imported) so the editor and its
// 3D face-scan code only download when the player opens it.
const CHARACTER_VAULT_KEY = 'pipe-dreams.character-vault.v1';

const PulseAvatarStage = lazy(() => import('./PulseAvatar_v0.2.0'));
const PipeDreamsCharacterCreator = lazy(() => import('./PipeDreamsCharacterCreator_v0.2.0'));

type Mode = 'game' | 'director' | 'character';
type Phase = 'idle' | 'playing' | 'results';
type TrackingStatus = 'off' | 'loading' | 'searching' | 'pose' | 'zones';

export interface PipeDreamsSongSession {
  songId?: string;
  title?: string;
  bpm?: number;
  durationMs?: number;
  sections?: Array<{ name: string; startMs: number; endMs: number }>;
}

export interface PulseMotionEvent {
  id: string;
  mode: Mode;
  action: string;
  zone: MotionZone;
  beat: number;
  bar: number;
  timestampMs: number;
  score: number;
  timingScore: number;
  movementScore: number;
  energyScore: number;
  timingErrorMs: number | null;
  peakMotion: number;
  character?: string;
  /** New in v0.2.0: 'pose' when the move was judged from body tracking, 'zones' when from picture movement. */
  tracking?: TrackingSource;
}

interface PulsePerformanceRoomProps {
  session?: PipeDreamsSongSession;
  onMotionEvents?: (events: PulseMotionEvent[]) => void;
}

interface LiveCue {
  def: CueDefinition;
  targetBeat: number;
  targetAt: number;
  peak: number;
  bestErr: number | null;
  peakEnergy: number;
}

interface LastResult {
  key: number;
  grade: Grade;
  score: number;
  label: string;
}

const FRAME_W = 96;
const FRAME_H = 72;
const COUNT_IN = 4;
/** Rough time from a real movement to the tracker seeing it (camera + processing). Judged in the player's favour. */
const CAMERA_LAG_MS = 90;
const QUIET_ZONES: ZoneEnergy = { left: 0, right: 0, top: 0, bottom: 0, center: 0, any: 0 };
/** One move per part of the picture, for Director mode when only motion zones are available. */
const ZONE_ONLY_IDS = ['step-left', 'step-right', 'grab-high', 'kick', 'guitar-hit'];

const MODES: Array<{ value: Mode; label: string; blurb: string }> = [
  { value: 'game', label: 'Game', blurb: 'Hit each move on the beat and chase a score.' },
  { value: 'director', label: 'Director', blurb: 'No prompts. Do your own moves and PULSE writes down each one and the beat it landed on.' },
  { value: 'character', label: 'Free play', blurb: 'Just you, the click and your character. Nothing is scored or recorded.' },
];

const GRADE_TEXT: Record<Grade, string> = { perfect: 'Perfect', nice: 'Nice', close: 'Close', miss: 'Miss' };
const GRADE_COLOR: Record<Grade, string> = { perfect: 'var(--gold)', nice: 'var(--ink)', close: 'var(--muted)', miss: 'var(--ember)' };

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(totalSeconds / 60) + ':' + String(totalSeconds % 60).padStart(2, '0');
}

function readLatestCharacter(): PipeDreamsCharacter | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CHARACTER_VAULT_KEY) || '[]');
    if (!Array.isArray(stored) || !stored.length) return null;
    const latest = stored[stored.length - 1];
    return latest && typeof latest.displayName === 'string' && latest.appearance ? latest as PipeDreamsCharacter : null;
  } catch {
    return null; // Browser storage may be unavailable.
  }
}

export default function PulsePerformanceRoom({ session, onMotionEvents }: PulsePerformanceRoomProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zoneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const skeletonRef = useRef<HTMLCanvasElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const trackerRef = useRef(new BodyTracker());
  const audioRef = useRef<PulseAudio | null>(null);
  const zonesRef = useRef<ZoneEnergy>(QUIET_ZONES);
  const lastBodyRef = useRef<BodyState>(restBody());
  const trackRef = useRef({ lastVideoTime: -1, lastPoseAt: 0, lastBodyAt: -1e9, interval: 30, cost: 12, frames: 0, fpsAt: 0, fps: 0, status: 'off' as TrackingStatus, debugAt: 0, cameraOn: false });
  const liveRef = useRef<PulseLive>({ body: restBody(), playing: false, beatPhase: 1, flashAt: 0, flashGrade: null });
  const gameRef = useRef({
    playing: false, startAt: 0, beatMs: 500, totalBeats: 0, lastBeat: -1,
    order: [] as CueDefinition[], cueIndex: 0, cueEvery: 2, cue: null as LiveCue | null,
    armed: {} as Record<string, boolean>, combo: 0, bestCombo: 0, events: [] as PulseMotionEvent[],
  });
  const tapsRef = useRef<number[]>([]);
  const poseLoadRef = useRef<Promise<void> | null>(null);
  const startingRef = useRef(false);
  const onMotionEventsRef = useRef(onMotionEvents);

  const [mode, setMode] = useState<Mode>('game');
  const [phase, setPhase] = useState<Phase>('idle');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNote, setCameraNote] = useState('');
  const [starting, setStarting] = useState(false);
  const [tracking, setTracking] = useState<TrackingStatus>('off');
  const [bpm, setBpm] = useState(session?.bpm || 104);
  const [cueEvery, setCueEvery] = useState(2);
  const [bars, setBars] = useState(16);
  const [assist, setAssist] = useState(35);
  const [sensitivity, setSensitivity] = useState(65);
  const [soundOn, setSoundOn] = useState(true);
  const [character, setCharacter] = useState<PipeDreamsCharacter | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [cameraBig, setCameraBig] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [cue, setCue] = useState<CueDefinition | null>(null);
  const [nextCue, setNextCue] = useState<CueDefinition | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const [events, setEvents] = useState<PulseMotionEvent[]>([]);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [debug, setDebug] = useState<{ fps: number; strengths: Record<string, number> }>({ fps: 0, strengths: {} });

  // The camera loop outlives any single render, so it reads the current settings from here.
  const cfgRef = useRef({ mode, bpm, cueEvery, bars, assist, sensitivity, characterName: '', detailsOpen, durationMs: session?.durationMs });
  const characterName = character?.displayName || 'Stand-in';
  cfgRef.current = { mode, bpm, cueEvery, bars, assist, sensitivity, characterName, detailsOpen, durationMs: session?.durationMs };

  useEffect(() => { if (session?.bpm) setBpm(session.bpm); }, [session?.bpm]);
  useEffect(() => { onMotionEventsRef.current = onMotionEvents; }, [onMotionEvents]);
  useEffect(() => { if (events.length) onMotionEventsRef.current?.(events); }, [events]);
  useEffect(() => { setCharacter(readLatestCharacter()); }, []);
  useEffect(() => {
    // Add ?debug=1 to the address to inspect the live tracking data from the browser console.
    if (new URLSearchParams(window.location.search).has('debug')) {
      (window as unknown as { __pulse?: unknown }).__pulse = { live: liveRef, game: gameRef, track: trackRef };
    }
  }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.enabled = soundOn; }, [soundOn]);

  const metrics = useMemo(() => {
    const count = (grade: Grade) => events.filter(event => gradeOf(event.score) === grade).length;
    const total = events.reduce((sum, event) => sum + event.score, 0);
    return {
      score: Math.round(total),
      accuracy: events.length ? Math.round(total / events.length) : 0,
      perfect: count('perfect'), nice: count('nice'), close: count('close'), miss: count('miss'),
    };
  }, [events]);

  const setTrackingStatus = (status: TrackingStatus) => {
    if (trackRef.current.status === status) return;
    trackRef.current.status = status;
    setTracking(status);
  };

  const pushEvent = (event: PulseMotionEvent) => {
    const game = gameRef.current;
    game.events = [...game.events, event];
    setEvents(game.events);
  };

  const finish = () => {
    const game = gameRef.current;
    if (!game.playing) return;
    game.playing = false;
    game.cue = null;
    liveRef.current.playing = false;
    liveRef.current.beatPhase = 1;
    audioRef.current?.stop();
    setCue(null);
    setNextCue(null);
    setBeat(-1);
    setPhase(game.events.length ? 'results' : 'idle');
  };

  const stopCamera = () => {
    finish();
    trackRef.current.cameraOn = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    previousFrameRef.current = null;
    zonesRef.current = QUIET_ZONES;
    trackerRef.current.reset();
    trackRef.current.lastBodyAt = -1e9;
    trackRef.current.lastPoseAt = 0;
    trackRef.current.lastVideoTime = -1;
    liveRef.current.body = restBody();
    const overlay = skeletonRef.current;
    overlay?.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
    setCameraOn(false);
    setTrackingStatus('off');
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    audioRef.current?.dispose();
  }, []);

  /** v0.1 motion check, kept as the fallback: how much the picture changed in each region. */
  const readMotion = (): ZoneEnergy | null => {
    const video = videoRef.current;
    const canvas = zoneCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    if (canvas.width !== FRAME_W) { canvas.width = FRAME_W; canvas.height = FRAME_H; }
    context.save();
    context.translate(FRAME_W, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, FRAME_W, FRAME_H);
    context.restore();

    const data = context.getImageData(0, 0, FRAME_W, FRAME_H).data;
    const previous = previousFrameRef.current;
    previousFrameRef.current = new Uint8ClampedArray(data);
    if (!previous || previous.length !== data.length) return null;

    let left = 0, right = 0, top = 0, bottom = 0, center = 0, all = 0;
    let leftCount = 0, rightCount = 0, topCount = 0, bottomCount = 0, centerCount = 0, allCount = 0;
    for (let y = 0; y < FRAME_H; y += 2) {
      for (let x = 0; x < FRAME_W; x += 2) {
        const index = (y * FRAME_W + x) * 4;
        const delta = Math.abs((data[index] + data[index + 1] + data[index + 2]) - (previous[index] + previous[index + 1] + previous[index + 2])) / 765;
        all += delta; allCount += 1;
        if (x < FRAME_W / 2) { left += delta; leftCount += 1; } else { right += delta; rightCount += 1; }
        if (y < FRAME_H * 0.42) { top += delta; topCount += 1; }
        if (y > FRAME_H * 0.58) { bottom += delta; bottomCount += 1; }
        if (x > FRAME_W * 0.28 && x < FRAME_W * 0.72 && y > FRAME_H * 0.22 && y < FRAME_H * 0.78) { center += delta; centerCount += 1; }
      }
    }
    return {
      left: left / Math.max(leftCount, 1), right: right / Math.max(rightCount, 1),
      top: top / Math.max(topCount, 1), bottom: bottom / Math.max(bottomCount, 1),
      center: center / Math.max(centerCount, 1), any: all / Math.max(allCount, 1),
    };
  };

  const drawSkeleton = (landmarks: Landmark[] | null) => {
    const canvas = skeletonRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const width = 320;
    const height = Math.round(width * (video.videoHeight || 3) / (video.videoWidth || 4));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!landmarks) return;
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.strokeStyle = 'rgba(240, 194, 122, 0.95)';
    context.fillStyle = '#ffeac2';
    const ok = (i: number) => landmarks[i] && (landmarks[i].visibility ?? 1) > 0.5;
    for (const [a, b] of SKELETON_LINES) {
      if (!ok(a) || !ok(b)) continue;
      context.beginPath();
      context.moveTo(landmarks[a].x * width, landmarks[a].y * height);
      context.lineTo(landmarks[b].x * width, landmarks[b].y * height);
      context.stroke();
    }
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if (!ok(i)) continue;
      context.beginPath();
      context.arc(landmarks[i].x * width, landmarks[i].y * height, 4, 0, Math.PI * 2);
      context.fill();
    }
  };

  const judgeCue = (liveCue: LiveCue, body: BodyState) => {
    const game = gameRef.current;
    const cfg = cfgRef.current;
    const result = scoreCue(liveCue.peak, liveCue.bestErr, liveCue.peakEnergy, cfg.assist);
    pushEvent({
      id: 'pulse-' + Date.now() + '-' + liveCue.targetBeat,
      mode: cfg.mode,
      action: liveCue.def.label,
      zone: liveCue.def.zone,
      beat: liveCue.targetBeat + 1,
      bar: Math.floor(liveCue.targetBeat / 4) + 1,
      timestampMs: Math.max(0, Math.round(liveCue.targetAt - game.startAt)),
      score: result.score,
      timingScore: result.timingScore,
      movementScore: result.movementScore,
      energyScore: result.energyScore,
      timingErrorMs: result.timingErrorMs,
      peakMotion: Number(liveCue.peak.toFixed(4)),
      character: cfg.characterName,
      tracking: body.source,
    });
    game.combo = result.score >= 65 ? game.combo + 1 : 0;
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    setCombo(game.combo);
    setBestCombo(game.bestCombo);
    setLast({ key: liveCue.targetBeat, grade: result.grade, score: result.score, label: liveCue.def.label });
    liveRef.current.flashAt = performance.now();
    liveRef.current.flashGrade = result.grade;
    audioRef.current?.hit(result.grade);
    game.cue = null;
    game.cueIndex += 1;
    setCue(null);
  };

  /** Game mode: show the next move, watch for it around its beat, then judge it. */
  const runCues = (now: number, beatFloat: number, body: BodyState, zones: ZoneEnergy) => {
    const game = gameRef.current;
    const cfg = cfgRef.current;
    const targetOf = (index: number) => COUNT_IN + index * game.cueEvery;
    const threshold = zoneThreshold(cfg.sensitivity, cfg.assist);

    // If the browser paused us (background tab), skip moves whose moment has already gone.
    while (!game.cue && game.cueIndex < game.order.length && beatFloat > targetOf(game.cueIndex) + 0.5) game.cueIndex += 1;

    if (!game.cue && game.cueIndex < game.order.length) {
      const targetBeat = targetOf(game.cueIndex);
      if (beatFloat >= targetBeat - Math.max(2, game.cueEvery)) {
        game.cue = { def: game.order[game.cueIndex], targetBeat, targetAt: game.startAt + targetBeat * game.beatMs, peak: 0, bestErr: null, peakEnergy: 0 };
        setCue(game.cue.def);
        setNextCue(game.order[game.cueIndex + 1] || null);
      }
    }

    const liveCue = game.cue;
    if (liveCue) {
      const seenAt = now - CAMERA_LAG_MS;
      const from = liveCue.targetAt - game.beatMs * 0.45;
      const to = liveCue.targetAt + game.beatMs * 0.5;
      if (seenAt >= from && seenAt <= to) {
        const strength = cueStrength(liveCue.def, body, zones, threshold);
        if (strength > liveCue.peak) liveCue.peak = strength;
        if (strength >= 0.5) {
          const error = Math.abs(seenAt - liveCue.targetAt);
          if (liveCue.bestErr === null || error < liveCue.bestErr) liveCue.bestErr = error;
        }
        liveCue.peakEnergy = Math.max(liveCue.peakEnergy, body.energy);
      }
      if (ringRef.current) {
        const lead = game.beatMs * Math.min(2, Math.max(1, game.cueEvery));
        const progress = clamp(1 - (liveCue.targetAt - now) / lead, 0, 1);
        ringRef.current.setAttribute('r', String(31 - progress * 11));
        ringRef.current.style.opacity = String(0.25 + progress * 0.75);
      }
      if (seenAt > to) judgeCue(liveCue, body);
    } else if (ringRef.current) {
      ringRef.current.style.opacity = '0';
    }
  };

  /** Director mode: no prompts. Each time the player clearly starts a move, write it down against the beat. */
  const captureMoves = (now: number, beatFloat: number, body: BodyState, zones: ZoneEnergy) => {
    const game = gameRef.current;
    const cfg = cfgRef.current;
    const threshold = zoneThreshold(cfg.sensitivity, cfg.assist);
    for (const def of CUES) {
      if (def.id === 'free') continue;
      if (body.source !== 'pose' && !ZONE_ONLY_IDS.includes(def.id)) continue;
      if (body.source === 'pose' && def.id === 'kick' && !body.legsVisible) continue;
      const strength = cueStrength(def, body, zones, threshold);
      const armed = game.armed[def.id] ?? true;
      if (!armed) {
        if (strength < 0.3) game.armed[def.id] = true;
        continue;
      }
      if (strength < 0.75) continue;
      game.armed[def.id] = false;
      const seenAt = now - CAMERA_LAG_MS;
      const nearest = Math.max(COUNT_IN, Math.round((seenAt - game.startAt) / game.beatMs));
      const error = Math.abs(seenAt - (game.startAt + nearest * game.beatMs));
      const timingScore = Math.round(clamp(100 - (error / (game.beatMs / 2)) * 100, 0, 100));
      const movementScore = Math.round(strength * 100);
      const energyScore = Math.round(body.energy * 100);
      pushEvent({
        id: 'pulse-' + Date.now() + '-' + def.id,
        mode: 'director',
        action: def.label,
        zone: def.zone,
        beat: nearest + 1,
        bar: Math.floor(nearest / 4) + 1,
        timestampMs: Math.max(0, Math.round(seenAt - game.startAt)),
        score: Math.round(timingScore * 0.5 + movementScore * 0.5),
        timingScore, movementScore, energyScore,
        timingErrorMs: Math.round(error),
        peakMotion: Number(strength.toFixed(4)),
        character: cfg.characterName,
        tracking: body.source,
      });
      setLast({ key: now, grade: timingScore >= 70 ? 'perfect' : 'nice', score: timingScore, label: def.label });
      liveRef.current.flashAt = performance.now();
      liveRef.current.flashGrade = 'nice';
    }
    void beatFloat;
  };

  const tick = (now: number) => {
    const video = videoRef.current;
    const track = trackRef.current;
    const cfg = cfgRef.current;

    const zones = readMotion();
    if (zones) zonesRef.current = zones;

    // Body tracking on each new camera frame (throttled so slower phones keep up).
    const pose = poseRef.current;
    if (pose && video && video.readyState >= 2 && video.currentTime !== track.lastVideoTime && now - track.lastPoseAt >= track.interval) {
      track.lastVideoTime = video.currentTime;
      track.lastPoseAt = now;
      const began = performance.now();
      try {
        const landmarks = pose.detectForVideo(video, now).landmarks?.[0] as Landmark[] | undefined;
        const body = landmarks ? trackerRef.current.update(landmarks, now, (video.videoWidth || 4) / (video.videoHeight || 3)) : null;
        if (body) {
          lastBodyRef.current = body;
          track.lastBodyAt = now;
        }
        drawSkeleton(body && landmarks ? landmarks : null);
      } catch {
        poseRef.current = null; // tracking broke on this device: carry on with motion zones
      }
      track.cost += (performance.now() - began - track.cost) * 0.1;
      track.interval = track.cost > 38 ? 66 : 30;
      track.frames += 1;
    }
    if (now - track.fpsAt >= 1000) {
      track.fps = Math.round((track.frames * 1000) / (now - track.fpsAt));
      track.frames = 0;
      track.fpsAt = now;
    }

    const bodySeen = now - track.lastBodyAt < 500;
    const body = bodySeen ? lastBodyRef.current : bodyFromZones(zonesRef.current, now);
    liveRef.current.body = body;
    if (track.cameraOn) {
      if (bodySeen) setTrackingStatus('pose');
      else if (poseRef.current) setTrackingStatus('searching');
      else if (track.status === 'pose' || track.status === 'searching') setTrackingStatus('zones');
    }

    const game = gameRef.current;
    if (game.playing) {
      const beatFloat = (now - game.startAt) / game.beatMs;
      const beatIndex = Math.floor(beatFloat);
      liveRef.current.beatPhase = beatFloat >= 0 ? beatFloat - beatIndex : 1;
      if (beatIndex >= 0 && beatIndex !== game.lastBeat) {
        game.lastBeat = beatIndex;
        setBeat(beatIndex);
      }
      if (cfg.mode === 'game') runCues(now, beatFloat, body, zonesRef.current);
      else if (cfg.mode === 'director' && beatFloat >= COUNT_IN - 0.5) captureMoves(now, beatFloat, body, zonesRef.current);
      if (game.totalBeats && beatFloat >= game.totalBeats + 0.75 && !game.cue) finish();
    }

    if (cfg.detailsOpen && now - track.debugAt > 200) {
      track.debugAt = now;
      const threshold = zoneThreshold(cfg.sensitivity, cfg.assist);
      setDebug({ fps: track.fps, strengths: Object.fromEntries(CUES.map(def => [def.id, cueStrength(def, body, zonesRef.current, threshold)])) });
    }

    rafRef.current = requestAnimationFrame(tickRef.current);
  };
  // Always call the newest tick, so it never runs with stale settings.
  const tickRef = useRef<(now: number) => void>(tick);
  tickRef.current = (now: number) => tick(now);

  const startCamera = async (): Promise<boolean> => {
    if (trackRef.current.cameraOn) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraNote('This browser cannot open the camera. Try Safari or Chrome.');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      trackRef.current.cameraOn = true;
      trackRef.current.fpsAt = performance.now();
      trackRef.current.frames = 0;
      previousFrameRef.current = null;
      setCameraOn(true);
      setCameraNote('');
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tickRef.current);

      if (poseRef.current) {
        setTrackingStatus('searching');
      } else {
        setTrackingStatus('loading');
        poseLoadRef.current = loadPoseTracker().then(pose => {
          poseRef.current = pose;
          if (trackRef.current.cameraOn) setTrackingStatus('searching');
        }).catch(() => {
          if (trackRef.current.cameraOn) setTrackingStatus('zones');
        });
      }
      return true;
    } catch {
      setCameraNote('The camera did not open. Allow camera access for this page, then try again.');
      return false;
    }
  };

  const start = async () => {
    // Sound has to be switched on from inside the tap itself on phones.
    if (!audioRef.current) audioRef.current = new PulseAudio();
    audioRef.current.enabled = soundOn;
    audioRef.current.unlock();
    if (startingRef.current || gameRef.current.playing) return;
    startingRef.current = true;
    setStarting(true);
    setPhase('idle');
    try {
      if (!(await startCamera())) return;
      // Loading body tracking for the first time can freeze the page for a moment. Let that happen
      // before the count-in rather than in the middle of it. If it takes too long, start anyway.
      const pause = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
      if (poseLoadRef.current && !poseRef.current) await Promise.race([poseLoadRef.current, pause(12000)]);
      for (let waited = 0; poseRef.current && trackRef.current.lastPoseAt === 0 && waited < 2500; waited += 100) await pause(100);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
    if (!trackRef.current.cameraOn) return;

    const game = gameRef.current;
    const tempo = clamp(bpm, 50, 220);
    game.beatMs = 60000 / tempo;
    game.cueEvery = cueEvery;
    const sessionBeats = session?.durationMs ? Math.ceil(session.durationMs / game.beatMs) : 0;
    const playBeats = mode === 'character' ? 0 : sessionBeats || bars * 4;
    game.totalBeats = playBeats ? COUNT_IN + playBeats : 0;
    game.order = mode === 'game' ? buildCueOrder(playBeats ? Math.floor(playBeats / cueEvery) : 4000, (Date.now() % 2147483646) + 1) : [];
    game.cueIndex = 0;
    game.cue = null;
    game.lastBeat = -1;
    game.armed = {};
    game.combo = 0;
    game.bestCombo = 0;
    game.events = [];
    game.startAt = audioRef.current.start(tempo, COUNT_IN);
    game.playing = true;
    liveRef.current.playing = true;
    liveRef.current.flashGrade = null;
    setEvents([]);
    setCombo(0);
    setBestCombo(0);
    setLast(null);
    setCue(null);
    setNextCue(mode === 'game' ? game.order[0] || null : null);
    setBeat(-1);
    setPhase('playing');
  };

  const tapTempo = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter(time => now - time < 2500);
    taps.push(now);
    tapsRef.current = taps.slice(-6);
    if (tapsRef.current.length >= 3) {
      const gaps = tapsRef.current.slice(1).map((time, index) => time - tapsRef.current[index]);
      setBpm(Math.round(clamp(60000 / (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length), 50, 220)));
    }
  };

  const exportEvents = () => {
    const payload = {
      schema: 'pipe-dreams.pulse.motion-events',
      version: PULSE_VERSION,
      song: session || null,
      bpm,
      mode,
      character: characterName,
      characterId: character?.id || null,
      events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pulse-motion-events-v' + PULSE_VERSION + '.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const playing = phase === 'playing';
  const countingIn = playing && beat < COUNT_IN;
  const beatInBar = beat >= 0 ? (beat % 4) + 1 : 0;
  const barNumber = beat >= COUNT_IN ? Math.floor((beat - COUNT_IN) / 4) + 1 : 0;
  const totalBars = gameRef.current.totalBeats ? (gameRef.current.totalBeats - COUNT_IN) / 4 : 0;
  const modeInfo = MODES.find(item => item.value === mode) || MODES[0];

  const trackingChip: Record<TrackingStatus, { text: string; tone: string }> = {
    off: { text: 'Camera off', tone: '' },
    loading: { text: 'Loading tracking', tone: 'busy' },
    searching: { text: 'Can’t see you', tone: 'on' },
    pose: { text: 'Tracking on', tone: 'good' },
    zones: { text: 'Motion only', tone: 'on' },
  };

  let cueTitle = 'Ready when you are';
  let cueHint = modeInfo.blurb;
  if (starting) {
    cueTitle = 'One moment';
    cueHint = tracking === 'loading' ? 'Loading body tracking. This only takes a while the first time.' : 'Opening the camera';
  } else if (playing && countingIn) {
    cueTitle = 'Get ready';
    cueHint = mode === 'game' && (cue || nextCue) ? 'First move: ' + (cue || nextCue)!.label : mode === 'director' ? 'Recording starts on the next bar' : 'Here comes the click';
  } else if (playing && mode === 'game') {
    cueTitle = cue ? cue.short : '…';
    cueHint = cue ? cue.hint : 'Nice. Next one is coming';
  } else if (playing && mode === 'director') {
    cueTitle = 'Recording';
    cueHint = last ? 'Got it: ' + last.label : 'Do your moves. Each one is written down on its beat.';
  } else if (playing) {
    cueTitle = 'Free play';
    cueHint = 'Move however you like. Your character follows.';
  } else if (phase === 'results') {
    cueTitle = 'Take complete';
    cueHint = 'Go again, or save the moves for the Music Video Room.';
  }

  const pipSpot = 'absolute right-2 top-2 w-[31%] max-w-[220px] aspect-[4/3] rounded-xl';
  const pipClass = pipSpot + ' z-20 overflow-hidden border border-[color:var(--line)] shadow-[0_8px_24px_-8px_#000]';
  const fullClass = 'absolute inset-0 z-0';

  return (
    <div className="pd-room min-h-screen text-[color:var(--ink)]">
      <div className="mx-auto grid max-w-6xl gap-3.5 px-4 pb-10 pt-3.5 md:px-6">
        <header className="pd-hairline flex items-center justify-between gap-2 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/emblem.webp" alt="" width={48} height={48} className="h-12 w-12 flex-none rounded-full mix-blend-screen shadow-[0_0_18px_1px_rgba(208,135,74,.26)]" />
            <h1 className="pd-lettering m-0 text-[1.35rem] font-bold leading-none tracking-[0.12em]">
              Pulse
              <span className="mt-1.5 block whitespace-nowrap text-[0.5em] font-semibold tracking-[0.2em]">Pipe Dreams Studio</span>
            </h1>
          </div>
          <span className={'pd-chip ' + trackingChip[tracking].tone} role="status" aria-live="polite">{trackingChip[tracking].text}</span>
        </header>

        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
          <div className="grid min-w-0 gap-3">
            {/* The move bar: what to do now, and how the last one went. */}
            <section className="pd-panel flex min-h-[86px] items-center gap-3 px-3 py-2.5" aria-live="polite">
              <svg viewBox="0 0 64 64" width="64" height="64" className="flex-none" aria-hidden="true">
                <circle cx="32" cy="32" r="20" fill="rgba(0,0,0,.35)" stroke="var(--gold)" strokeWidth="2.5" />
                <circle ref={ringRef} cx="32" cy="32" r="31" fill="none" stroke="var(--copper)" strokeWidth="2.5" style={{ opacity: 0 }} />
                <text x="32" y="33" textAnchor="middle" dominantBaseline="middle" fill="var(--ink)"
                  style={{ font: '700 20px var(--font-display)' }}>
                  {playing && beat >= 0 ? (countingIn ? COUNT_IN - beat : beatInBar) : '•'}
                </text>
              </svg>
              <div className="min-w-0 flex-1">
                <div className={'pd-lettering truncate font-bold leading-none tracking-[0.06em] ' + (playing && mode === 'game' && !countingIn ? 'text-[2rem]' : 'text-[1.15rem]')}>{cueTitle}</div>
                <div className="mt-1.5 text-[0.875rem] leading-snug text-[color:var(--muted)]">{cueHint}</div>
              </div>
              {playing && last && !countingIn && (
                <div key={last.key} className="pd-grade flex-none text-right">
                  <div className="font-display text-[0.95rem] font-bold uppercase tracking-[0.1em]" style={{ color: mode === 'director' ? 'var(--gold)' : GRADE_COLOR[last.grade] }}>
                    {mode === 'director' ? 'Captured' : GRADE_TEXT[last.grade]}
                  </div>
                  <div className="text-[0.8125rem] text-[color:var(--muted)]">{mode === 'director' ? last.label : last.score + ' pts'}</div>
                </div>
              )}
            </section>

            {/* Stage: your character big, the camera small. Tap the small one to swap. */}
            <section className="relative aspect-square overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[#0a0605] sm:aspect-[4/3] lg:aspect-[16/10]">
              <div className={cameraBig ? pipClass : fullClass}>
                <Suspense fallback={<div className="grid h-full place-items-center text-sm text-[color:var(--faint)]">Setting the stage</div>}>
                  <PulseAvatarStage character={character} live={liveRef} />
                </Suspense>
              </div>
              <div className={(cameraBig ? fullClass : pipClass) + ' bg-black'}>
                <video ref={videoRef} muted playsInline className="h-full w-full object-cover [transform:scaleX(-1)]" />
                <canvas ref={skeletonRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]" />
                {!cameraOn && <div className="absolute inset-0 grid place-items-center bg-[#0c0806] px-2 text-center text-[0.75rem] leading-tight text-[color:var(--faint)]">Camera off</div>}
              </div>
              <button type="button" onClick={() => setCameraBig(value => !value)}
                aria-label={cameraBig ? 'Show my character big' : 'Show the camera big'}
                className={pipSpot + ' z-30 cursor-pointer border-0 bg-transparent p-0'}>
                <span className="absolute bottom-1 left-1 rounded-full bg-black/65 px-2 py-0.5 text-[0.6875rem] text-[color:var(--muted)]">{cameraBig ? characterName : 'You'} · swap</span>
              </button>

              {playing && mode === 'game' && (
                <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl border border-[color:var(--line-soft)] bg-black/55 px-3 py-2">
                  <div className="pd-label">Score</div>
                  <div className="font-display text-2xl font-bold leading-none text-[color:var(--gold)] [font-variant-numeric:tabular-nums]">{metrics.score}</div>
                  {combo >= 2 && <div className="mt-1 text-[0.8125rem] text-[color:var(--ink)]">Combo ×{combo}</div>}
                </div>
              )}
              {playing && !countingIn && tracking !== 'searching' && (
                <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-black/55 px-3 py-1 text-[0.8125rem] text-[color:var(--muted)] [font-variant-numeric:tabular-nums]">
                  Bar {barNumber}{totalBars ? ' of ' + totalBars : ''}
                  {mode === 'game' && nextCue && cue ? ' · next: ' + nextCue.label : ''}
                </div>
              )}
              {phase !== 'results' && (!playing || tracking === 'searching') && (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center">
                  <div className="rounded-xl bg-black/70 px-3 py-1.5 text-center text-[0.875rem] leading-snug text-[color:var(--ink)]">
                    {tracking === 'searching'
                      ? 'I can’t see you yet. Step back until the small picture shows your head, arms and hips.'
                      : cameraOn
                        ? 'Stand back so the small picture shows your head, arms and hips. Then hit Start.'
                        : characterName + ' is on stage. Start turns the camera on and counts you in.'}
                  </div>
                </div>
              )}

              {phase === 'results' && (
                <div className="absolute inset-0 z-40 grid place-items-center bg-[rgba(7,5,4,.86)] p-4 text-center">
                  <div className="grid w-full max-w-sm gap-3">
                    <div className="pd-label">{mode === 'director' ? 'Moves captured' : 'Final score'}</div>
                    <div className="pd-lettering text-6xl font-bold leading-none [font-variant-numeric:tabular-nums]">{mode === 'director' ? events.length : metrics.score}</div>
                    {mode === 'game' && (
                      <>
                        <div className="text-[0.9375rem] text-[color:var(--muted)]">
                          Average {metrics.accuracy} out of 100 per move · best combo ×{bestCombo}
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {(['perfect', 'nice', 'close', 'miss'] as Grade[]).map(grade => (
                            <div key={grade} className="rounded-xl border border-[color:var(--line-soft)] bg-black/40 px-1 py-2">
                              <div className="font-display text-xl font-bold" style={{ color: GRADE_COLOR[grade] }}>{metrics[grade]}</div>
                              <div className="text-[0.75rem] text-[color:var(--muted)]">{GRADE_TEXT[grade]}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      <button type="button" className="pd-btn" onClick={start}>Go again</button>
                      <button type="button" className="pd-btn ghost" onClick={exportEvents}>Save moves</button>
                      <button type="button" className="pd-btn ghost" onClick={() => setPhase('idle')}>Close</button>
                    </div>
                  </div>
                </div>
              )}
              <canvas ref={zoneCanvasRef} className="hidden" />
            </section>

            <div className="flex flex-wrap items-center gap-2">
              {!playing
                ? <button type="button" className="pd-btn flex-1" disabled={starting} onClick={start}>{starting ? 'Getting ready' : phase === 'results' ? 'Go again' : 'Start'}</button>
                : <button type="button" className="pd-btn stop flex-1" onClick={finish}>Stop</button>}
              {cameraOn
                ? <button type="button" className="pd-btn ghost" onClick={stopCamera}>Camera off</button>
                : <button type="button" className="pd-btn ghost" onClick={() => { void startCamera(); }}>Camera on</button>}
            </div>
            {cameraNote && <p className="m-0 rounded-xl border border-[rgba(255,112,77,.6)] bg-[rgba(255,112,77,.1)] px-3 py-2 text-[0.875rem]" role="alert">{cameraNote}</p>}
            <p className="m-0 text-[0.8125rem] leading-snug text-[color:var(--faint)]">
              Your camera picture stays on this device. Nothing is uploaded.
              {tracking === 'zones' && ' Body tracking is not running, so moves are judged by movement in each part of the picture.'}
            </p>
          </div>

          <div className="grid min-w-0 gap-3.5">
            <section className="pd-panel grid gap-2.5 p-3.5">
              <h2 className="pd-lettering m-0 text-[0.9375rem] font-semibold tracking-[0.09em]">Session</h2>
              <div className="pd-seg" role="group" aria-label="Mode">
                {MODES.map(item => (
                  <button key={item.value} type="button" aria-pressed={mode === item.value} disabled={playing} onClick={() => { setMode(item.value); if (phase === 'results') setPhase('idle'); }}>
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="m-0 text-[0.875rem] leading-snug text-[color:var(--muted)]">{modeInfo.blurb}</p>
              <div>
                <label className="pd-row">
                  <span>Tempo</span>
                  <input type="range" min="50" max="220" value={bpm} disabled={playing} onChange={event => setBpm(Number(event.target.value))} />
                  <output>{bpm} BPM</output>
                </label>
                <div className="pd-row wide">
                  <span className="text-[color:var(--muted)]">Or tap along to your song</span>
                  <button type="button" className="pd-btn ghost small justify-self-end" disabled={playing} onClick={tapTempo}>Tap tempo</button>
                </div>
                {mode === 'game' && <label className="pd-row wide">
                  <span>Moves come</span>
                  <select value={cueEvery} disabled={playing} onChange={event => setCueEvery(Number(event.target.value))}
                    className="min-h-[40px] w-full rounded-full border border-[color:var(--line)] bg-black/40 px-3.5 text-[0.9375rem]">
                    <option value={1}>Every beat (hard)</option>
                    <option value={2}>Every 2 beats</option>
                    <option value={4}>Once a bar (easy)</option>
                  </select>
                </label>}
                {mode !== 'character' && !session?.durationMs && <label className="pd-row wide">
                  <span>Length</span>
                  <select value={bars} disabled={playing} onChange={event => setBars(Number(event.target.value))}
                    className="min-h-[40px] w-full rounded-full border border-[color:var(--line)] bg-black/40 px-3.5 text-[0.9375rem]">
                    {[8, 16, 32, 64].map(count => <option key={count} value={count}>{count} bars · about {formatMs(count * 4 * 60000 / bpm)}</option>)}
                  </select>
                </label>}
                {mode === 'game' && <label className="pd-row">
                  <span>Forgiveness</span>
                  <input type="range" min="0" max="100" value={assist} onChange={event => setAssist(Number(event.target.value))} />
                  <output>{assist}%</output>
                </label>}
                <label className="pd-row wide">
                  <span>Click and hit sounds</span>
                  <input type="checkbox" className="pd-switch" checked={soundOn} onChange={event => setSoundOn(event.target.checked)} />
                </label>
              </div>
            </section>

            <section className="pd-panel grid gap-2.5 p-3.5">
              <h2 className="pd-lettering m-0 text-[0.9375rem] font-semibold tracking-[0.09em]">Your character</h2>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[1.0625rem]">{characterName}</div>
                  <div className="text-[0.8125rem] leading-snug text-[color:var(--muted)]">
                    {character ? (character.facePoints ? 'Wearing your scanned face.' : 'Saved look, no face scan yet.') : 'The house stand-in. Build your own from a selfie.'}
                  </div>
                </div>
                <button type="button" className="pd-btn ghost small" disabled={playing} onClick={() => setShowCreator(true)}>{character ? 'Edit character' : 'Build my character'}</button>
              </div>
            </section>

            <section className="pd-panel grid gap-2.5 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="pd-lettering m-0 text-[0.9375rem] font-semibold tracking-[0.09em]">Captured moves</h2>
                <button type="button" className="pd-btn ghost small" disabled={!events.length} onClick={exportEvents}>Save moves</button>
              </div>
              <div className="max-h-56 overflow-y-auto pr-1">
                {!events.length && <p className="m-0 text-[0.875rem] text-[color:var(--muted)]">Nothing yet. Each move you land shows up here with its bar and beat, ready for the Music Video Room.</p>}
                {events.slice().reverse().map(event => (
                  <div key={event.id} className="flex items-center justify-between gap-3 border-t border-[color:var(--line-soft)] py-2 first:border-t-0">
                    <div className="min-w-0">
                      <div className="truncate text-[0.9375rem]">{event.action}</div>
                      <div className="text-[0.75rem] text-[color:var(--faint)] [font-variant-numeric:tabular-nums]">Bar {event.bar} · beat {((event.beat - 1) % 4) + 1} · {formatMs(event.timestampMs)}</div>
                    </div>
                    <div className="font-display text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ color: event.score >= 85 ? 'var(--gold)' : event.score >= 65 ? 'var(--ink)' : 'var(--faint)' }}>{event.score}</div>
                  </div>
                ))}
              </div>
            </section>

            <details className="pd-panel p-3.5" onToggle={event => setDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}>
              <summary className="pd-lettering cursor-pointer text-[0.9375rem] font-semibold tracking-[0.09em]">Tracking details</summary>
              <div className="mt-3 grid gap-2.5">
                <p className="m-0 text-[0.875rem] leading-snug text-[color:var(--muted)]">
                  {tracking === 'pose' ? 'Tracking your body ' + debug.fps + ' times a second. ' : tracking === 'off' ? 'Turn the camera on to see what PULSE picks up. ' : ''}
                  Each bar fills as you do that move. A move counts once its bar is past halfway.
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {CUES.map(def => (
                    <div key={def.id} data-move={def.id} data-strength={(debug.strengths[def.id] || 0).toFixed(2)}>
                      <div className="mb-1 text-[0.8125rem] text-[color:var(--muted)]">{def.label}</div>
                      <div className="pd-meter"><i style={{ width: Math.round((debug.strengths[def.id] || 0) * 100) + '%' }} /></div>
                    </div>
                  ))}
                </div>
                <label className="pd-row">
                  <span>Motion sensitivity</span>
                  <input type="range" min="1" max="100" value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} />
                  <output>{sensitivity}%</output>
                </label>
                <p className="m-0 text-[0.8125rem] leading-snug text-[color:var(--faint)]">Sensitivity only matters when body tracking is not running.</p>
              </div>
            </details>
          </div>
        </div>

        <footer className="text-center text-[0.75rem] text-[color:var(--faint)]">PULSE v{PULSE_VERSION} · Pipe Dreams Studio by MPJrecords</footer>
      </div>

      {showCreator && (
        <div role="dialog" aria-modal="true" aria-label="My Character" className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(7,5,4,.94)] p-3 backdrop-blur-sm md:p-8">
          <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-[color:var(--muted)]">Opening the character studio</div>}>
            <PipeDreamsCharacterCreator onClose={() => setShowCreator(false)}
              onSave={saved => { setCharacter(saved); setShowCreator(false); }} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
