'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

export const PULSE_VERSION = '0.1.0';

type Mode = 'game' | 'director' | 'character';
type MotionZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'both' | 'any';

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
}

interface PulsePerformanceRoomProps {
  session?: PipeDreamsSongSession;
  onMotionEvents?: (events: PulseMotionEvent[]) => void;
}

interface CueDefinition {
  id: string;
  label: string;
  short: string;
  zone: MotionZone;
}

interface LiveCue extends CueDefinition {
  targetBeat: number;
  targetAt: number;
  peakMotion: number;
  peakAt: number | null;
}

interface ZoneEnergy {
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  any: number;
}

const FRAME_W = 96;
const FRAME_H = 72;

const CUES: CueDefinition[] = [
  { id: 'step-left', label: 'Step left', short: 'LEFT', zone: 'left' },
  { id: 'step-right', label: 'Step right', short: 'RIGHT', zone: 'right' },
  { id: 'grab-high', label: 'Grab it', short: 'GRAB', zone: 'top' },
  { id: 'kick', label: 'Kick', short: 'KICK', zone: 'bottom' },
  { id: 'point-left', label: 'Point left', short: 'POINT', zone: 'left' },
  { id: 'duck', label: 'Duck', short: 'DUCK', zone: 'bottom' },
  { id: 'turn', label: 'Turn / sweep', short: 'TURN', zone: 'both' },
  { id: 'lean-right', label: 'Lean right', short: 'LEAN', zone: 'right' },
  { id: 'throw', label: 'Throw it', short: 'THROW', zone: 'top' },
  { id: 'guitar-hit', label: 'Guitar hit', short: 'HIT', zone: 'center' },
  { id: 'mic-grab', label: 'Grab the mic', short: 'MIC', zone: 'center' },
  { id: 'free', label: 'Free move', short: 'FREE', zone: 'any' },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function cueEnergy(zones: ZoneEnergy, zone: MotionZone): number {
  if (zone === 'both') return (zones.left + zones.right) / 2;
  if (zone === 'any') return zones.any;
  return zones[zone];
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

export default function PulsePerformanceRoom({ session, onMotionEvents }: PulsePerformanceRoomProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const startAtRef = useRef<number>(0);
  const nextTargetBeatRef = useRef<number>(4);
  const cueRef = useRef<LiveCue | null>(null);
  const lastBeatRef = useRef<number>(-1);
  const cueIndexRef = useRef<number>(0);
  const playingRef = useRef<boolean>(false);

  const [mode, setMode] = useState<Mode>('game');
  const [cameraOn, setCameraOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(session?.bpm || 104);
  const [cueEvery, setCueEvery] = useState(2);
  const [sensitivity, setSensitivity] = useState(65);
  const [assist, setAssist] = useState(35);
  const [characterName, setCharacterName] = useState('Pipe Dreams Fox');
  const [status, setStatus] = useState('Camera is off');
  const [currentBeat, setCurrentBeat] = useState(0);
  const [currentCue, setCurrentCue] = useState<LiveCue | null>(null);
  const [zones, setZones] = useState<ZoneEnergy>({ left: 0, right: 0, top: 0, bottom: 0, center: 0, any: 0 });
  const [events, setEvents] = useState<PulseMotionEvent[]>([]);
  const [combo, setCombo] = useState(0);

  useEffect(() => {
    if (session?.bpm) setBpm(session.bpm);
  }, [session?.bpm]);

  const metrics = useMemo(() => {
    const scores = events.map(event => event.score);
    const timing = events.map(event => event.timingScore);
    const movement = events.map(event => event.movementScore);
    const energy = events.map(event => event.energyScore);
    return {
      score: Math.round(scores.reduce((sum, value) => sum + value, 0)),
      timing: Math.round(avg(timing)),
      movement: Math.round(avg(movement)),
      energy: Math.round(avg(energy)),
      attempts: events.length,
    };
  }, [events]);

  const beatMs = 60000 / clamp(bpm, 50, 220);
  const bar = Math.floor(currentBeat / 4) + 1;
  const beatInBar = (currentBeat % 4) + 1;

  const stopGame = () => {
    playingRef.current = false;
    setPlaying(false);
    cueRef.current = null;
    setCurrentCue(null);
    setStatus(cameraOn ? 'Camera ready' : 'Camera is off');
  };

  const stopCamera = () => {
    stopGame();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    previousFrameRef.current = null;
    setCameraOn(false);
    setStatus('Camera is off');
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const evaluateCue = (cue: LiveCue, now: number) => {
    const threshold = clamp(0.15 - (sensitivity / 100) * 0.08 - (assist / 100) * 0.035, 0.03, 0.15);
    const timingWindow = 190 + assist * 3.1;
    const timingError = cue.peakAt === null ? null : Math.abs(cue.peakAt - cue.targetAt);
    const timingScore = timingError === null ? 0 : Math.round(clamp(100 - (timingError / timingWindow) * 100, 0, 100));
    const movementScore = Math.round(clamp(((cue.peakMotion - threshold) / Math.max(0.18 - threshold, 0.04)) * 100, 0, 100));
    const energyScore = Math.round(clamp(cue.peakMotion * 420, 0, 100));
    const score = Math.round(timingScore * 0.45 + movementScore * 0.4 + energyScore * 0.15);
    const timestampMs = Math.max(0, cue.targetAt - startAtRef.current);

    const event: PulseMotionEvent = {
      id: 'pulse-' + Date.now() + '-' + cue.targetBeat,
      mode,
      action: cue.label,
      zone: cue.zone,
      beat: cue.targetBeat + 1,
      bar: Math.floor(cue.targetBeat / 4) + 1,
      timestampMs,
      score,
      timingScore,
      movementScore,
      energyScore,
      timingErrorMs: timingError === null ? null : Math.round(timingError),
      peakMotion: Number(cue.peakMotion.toFixed(4)),
      character: mode === 'character' ? characterName : undefined,
    };

    setEvents(previous => {
      const next = [...previous, event];
      onMotionEvents?.(next);
      return next;
    });

    setCombo(previous => score >= 65 ? previous + 1 : 0);
    setStatus(score >= 85 ? 'Perfect hit' : score >= 65 ? 'Nice move' : 'Keep moving');
    cueRef.current = null;
    setCurrentCue(null);
    nextTargetBeatRef.current = cue.targetBeat + cueEvery;
  };

  const createCue = (targetBeat: number) => {
    const definition = CUES[cueIndexRef.current % CUES.length];
    cueIndexRef.current += 1;
    const cue: LiveCue = {
      ...definition,
      targetBeat,
      targetAt: startAtRef.current + targetBeat * beatMs,
      peakMotion: 0,
      peakAt: null,
    };
    cueRef.current = cue;
    setCurrentCue(cue);
    setStatus('Get ready: ' + cue.label);
  };

  const readMotion = (): ZoneEnergy | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    context.save();
    context.translate(FRAME_W, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, FRAME_W, FRAME_H);
    context.restore();

    const data = context.getImageData(0, 0, FRAME_W, FRAME_H).data;
    const previous = previousFrameRef.current;
    previousFrameRef.current = new Uint8ClampedArray(data);

    if (!previous || previous.length !== data.length) return null;

    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;
    let center = 0;
    let all = 0;
    let leftCount = 0;
    let rightCount = 0;
    let topCount = 0;
    let bottomCount = 0;
    let centerCount = 0;
    let allCount = 0;

    for (let y = 0; y < FRAME_H; y += 2) {
      for (let x = 0; x < FRAME_W; x += 2) {
        const index = (y * FRAME_W + x) * 4;
        const currentGray = (data[index] + data[index + 1] + data[index + 2]) / 3;
        const previousGray = (previous[index] + previous[index + 1] + previous[index + 2]) / 3;
        const delta = Math.abs(currentGray - previousGray) / 255;

        all += delta;
        allCount += 1;

        if (x < FRAME_W / 2) {
          left += delta;
          leftCount += 1;
        } else {
          right += delta;
          rightCount += 1;
        }

        if (y < FRAME_H * 0.42) {
          top += delta;
          topCount += 1;
        }
        if (y > FRAME_H * 0.58) {
          bottom += delta;
          bottomCount += 1;
        }
        if (x > FRAME_W * 0.28 && x < FRAME_W * 0.72 && y > FRAME_H * 0.22 && y < FRAME_H * 0.78) {
          center += delta;
          centerCount += 1;
        }
      }
    }

    return {
      left: left / Math.max(leftCount, 1),
      right: right / Math.max(rightCount, 1),
      top: top / Math.max(topCount, 1),
      bottom: bottom / Math.max(bottomCount, 1),
      center: center / Math.max(centerCount, 1),
      any: all / Math.max(allCount, 1),
    };
  };

  const tick = (now: number) => {
    const nextZones = readMotion();
    if (nextZones) {
      setZones(nextZones);
      const cue = cueRef.current;
      if (cue && playingRef.current) {
        const activeStart = cue.targetAt - beatMs * 0.45;
        const activeEnd = cue.targetAt + beatMs * 0.68;
        if (now >= activeStart && now <= activeEnd) {
          const energy = cueEnergy(nextZones, cue.zone);
          if (energy > cue.peakMotion) {
            cue.peakMotion = energy;
            cue.peakAt = now;
            cueRef.current = cue;
          }
        }
      }
    }

    if (playingRef.current) {
      const elapsed = Math.max(0, now - startAtRef.current);
      const beatFloat = elapsed / beatMs;
      const beatIndex = Math.floor(beatFloat);

      if (beatIndex !== lastBeatRef.current) {
        lastBeatRef.current = beatIndex;
        setCurrentBeat(beatIndex);
      }

      const nextTarget = nextTargetBeatRef.current;
      if (!cueRef.current && beatFloat >= nextTarget - 1 && beatFloat < nextTarget + 0.5) {
        createCue(nextTarget);
      }

      const cue = cueRef.current;
      if (cue && now > cue.targetAt + beatMs * 0.72) {
        evaluateCue(cue, now);
      }

      if (session?.durationMs && elapsed >= session.durationMs) {
        stopGame();
        setStatus('Song complete');
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera access is not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setStatus('Camera ready');
      previousFrameRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setStatus('Camera permission was denied or unavailable');
    }
  };

  const startGame = () => {
    if (!cameraOn) {
      setStatus('Turn the camera on first');
      return;
    }

    startAtRef.current = performance.now();
    nextTargetBeatRef.current = 4;
    cueIndexRef.current = 0;
    lastBeatRef.current = -1;
    cueRef.current = null;
    playingRef.current = true;
    setCurrentCue(null);
    setCurrentBeat(0);
    setCombo(0);
    setEvents([]);
    setPlaying(true);
    setStatus('Four-beat count-in');
  };

  const exportEvents = () => {
    const payload = {
      schema: 'pipe-dreams.pulse.motion-events',
      version: PULSE_VERSION,
      song: session || null,
      bpm,
      mode,
      character: mode === 'character' ? characterName : null,
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

  const liveMotion = Math.round(clamp(zones.any * 420, 0, 100));
  const cueProgress = currentCue
    ? clamp(1 - ((currentCue.targetAt - performance.now()) / beatMs), 0, 1)
    : 0;

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Pipe Dreams Studio</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight md:text-5xl">PULSE <span className="text-cyan-300">v{PULSE_VERSION}</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Camera-controlled rhythm performance capture. Play the beat, record the movement, hand the motion data to the Music Video Room.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <div className="text-white/45">Song clock</div>
            <div className="font-semibold">{session?.title || 'Untitled performance'} · {bpm} BPM</div>
          </div>
        </header>

        <div className="mb-5 grid gap-3 md:grid-cols-3">
          {([
            ['game', 'GAME', 'Follow beat-synced moves and chase a score.'],
            ['director', 'DIRECTOR', 'Capture intentional choreography for a music-video timeline.'],
            ['character', 'CHARACTER', 'Perform motion now, retarget it to an avatar or creature later.'],
          ] as Array<[Mode, string, string]>).map(([value, label, description]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={'rounded-2xl border p-4 text-left transition ' + (mode === value ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]') + (cameraOn ? ' cursor-not-allowed opacity-70' : '')}
            >
              <div className="text-sm font-black tracking-[0.18em]">{label}</div>
              <div className="mt-1 text-xs leading-5 text-white/55">{description}</div>
            </button>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.55fr_0.85fr]">
          <section className="overflow-hidden rounded-3xl border border-white/10 bg-black">
            <div className="relative aspect-video bg-[#10141b]">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover [transform:scaleX(-1)]" />
              {!cameraOn && (
                <div className="absolute inset-0 grid place-items-center p-8 text-center">
                  <div>
                    <div className="text-5xl">◉</div>
                    <div className="mt-3 text-lg font-bold">Camera becomes the controller</div>
                    <div className="mt-1 text-sm text-white/45">Nothing is uploaded by this MVP. Motion is measured locally in the browser.</div>
                  </div>
                </div>
              )}

              <div className="pointer-events-none absolute inset-0 grid grid-cols-2">
                <div className="border-r border-cyan-300/15"></div>
                <div></div>
              </div>
              <div className="pointer-events-none absolute inset-x-0 top-[42%] border-t border-cyan-300/10"></div>
              <div className="pointer-events-none absolute inset-x-0 top-[58%] border-t border-cyan-300/10"></div>

              {playing && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/15">
                  <div className="mb-3 rounded-full border border-white/15 bg-black/55 px-4 py-1 text-xs font-semibold tracking-[0.2em] text-white/70">
                    BAR {bar} · BEAT {beatInBar}
                  </div>
                  <div className={'text-center font-black drop-shadow-2xl ' + (currentCue ? 'text-6xl md:text-8xl' : 'text-3xl text-white/50')}>
                    {currentCue ? currentCue.short : currentBeat < 4 ? String(Math.max(1, 4 - currentBeat)) : 'MOVE'}
                  </div>
                  {currentCue && (
                    <>
                      <div className="mt-2 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-200">{currentCue.label}</div>
                      <div className="mt-4 h-2 w-52 overflow-hidden rounded-full bg-white/15">
                        <div className="h-full bg-cyan-300 transition-[width] duration-75" style={{ width: Math.round(cueProgress * 100) + '%' }} />
                      </div>
                    </>
                  )}
                </div>
              )}

              {mode === 'character' && (
                <div className="absolute bottom-3 left-3 rounded-xl border border-fuchsia-300/20 bg-black/65 px-3 py-2 text-xs">
                  Retarget target: <span className="font-bold text-fuchsia-200">{characterName || 'Unnamed character'}</span>
                </div>
              )}

              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.025] p-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-white/40">Status</div>
                <div className="font-semibold">{status}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!cameraOn ? (
                  <button type="button" onClick={startCamera} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black">Turn camera on</button>
                ) : (
                  <button type="button" onClick={stopCamera} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-bold">Camera off</button>
                )}
                {!playing ? (
                  <button type="button" onClick={startGame} disabled={!cameraOn} className="rounded-xl bg-cyan-300 px-5 py-2 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40">Start performance</button>
                ) : (
                  <button type="button" onClick={stopGame} className="rounded-xl bg-red-400 px-5 py-2 text-sm font-black text-black">Stop</button>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <div className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-white/45">Scoreboard</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['SCORE', metrics.score],
                  ['COMBO', combo],
                  ['TIMING', metrics.timing + '%'],
                  ['MOVEMENT', metrics.movement + '%'],
                  ['ENERGY', metrics.energy + '%'],
                  ['LIVE MOTION', liveMotion + '%'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <div className="text-[10px] font-bold tracking-[0.16em] text-white/40">{label}</div>
                    <div className="mt-1 text-2xl font-black">{value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <div className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-white/45">Performance controls</div>

              <label className="mb-4 block">
                <span className="mb-1 flex justify-between text-xs text-white/60"><span>BPM</span><span>{bpm}</span></span>
                <input type="range" min="50" max="220" value={bpm} onChange={event => setBpm(Number(event.target.value))} disabled={cameraOn} className="w-full disabled:opacity-50" />
              </label>

              <label className="mb-4 block">
                <span className="mb-1 flex justify-between text-xs text-white/60"><span>Cue spacing</span><span>every {cueEvery} beat{cueEvery === 1 ? '' : 's'}</span></span>
                <select value={cueEvery} onChange={event => setCueEvery(Number(event.target.value))} disabled={cameraOn} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm">
                  <option value={1}>Every beat</option>
                  <option value={2}>Every 2 beats</option>
                  <option value={4}>Every bar</option>
                </select>
              </label>

              <label className="mb-4 block">
                <span className="mb-1 flex justify-between text-xs text-white/60"><span>Camera sensitivity</span><span>{sensitivity}%</span></span>
                <input type="range" min="1" max="100" value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} disabled={cameraOn} className="w-full disabled:opacity-50" />
              </label>

              <label className="block">
                <span className="mb-1 flex justify-between text-xs text-white/60"><span>Assist</span><span>{assist}%</span></span>
                <input type="range" min="0" max="100" value={assist} onChange={event => setAssist(Number(event.target.value))} disabled={cameraOn} className="w-full disabled:opacity-50" />
                <span className="mt-1 block text-[11px] leading-4 text-white/35">v0.1 uses Assist as timing/motion forgiveness. Character animation cleanup plugs into this control later.</span>
              </label>

              {mode === 'character' && (
                <label className="mt-4 block">
                  <span className="mb-1 block text-xs text-white/60">Character / avatar</span>
                  <input value={characterName} onChange={event => setCharacterName(event.target.value)} disabled={cameraOn} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" placeholder="Fox, robot, avatar..." />
                </label>
              )}
            </section>
          </aside>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Motion zones</div>
                <div className="mt-1 text-sm text-white/55">The first controller is intentionally simple and robust: movement energy by camera region.</div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(['left', 'right', 'top', 'bottom', 'center'] as const).map(zone => (
                <div key={zone} className="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">{zone}</div>
                  <div className="mt-1 font-black">{Math.round(clamp(zones[zone] * 420, 0, 100))}%</div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-xs leading-5 text-amber-100/75">
              Next tracking upgrade: swap the zone detector for MediaPipe/Pose landmarks while keeping this exact song-clock, cue, scoring, and motion-event contract.
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Captured choreography</div>
                <div className="mt-1 text-sm text-white/55">{events.length} motion event{events.length === 1 ? '' : 's'} ready for handoff.</div>
              </div>
              <button type="button" onClick={exportEvents} disabled={!events.length} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-bold disabled:opacity-35">Export JSON</button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {!events.length && <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/35">Start a performance to build the motion timeline.</div>}
              {events.slice().reverse().map(event => (
                <div key={event.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <div>
                    <div className="text-sm font-bold">{event.action}</div>
                    <div className="text-[11px] text-white/40">Bar {event.bar} · Beat {event.beat} · {formatMs(event.timestampMs)}</div>
                  </div>
                  <div className={'text-xl font-black ' + (event.score >= 85 ? 'text-cyan-300' : event.score >= 65 ? 'text-white' : 'text-white/45')}>{event.score}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-5 text-white/45">
          <span className="font-bold text-white/70">PULSE v{PULSE_VERSION} contract:</span> PIPES/HIGH-DEA can provide the song session and BPM; PULSE returns timestamped motion events. The Music Video Room can later replace zone tracking with body landmarks and retarget the same events to the artist avatar, fox, creature, or other saved character.
        </footer>
      </div>
    </div>
  );
}
