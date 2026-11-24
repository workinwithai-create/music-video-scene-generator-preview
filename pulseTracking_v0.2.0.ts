/**
 * PULSE v0.2.0 body tracking maths.
 *
 * Turns MediaPipe pose landmarks into a small "body state" (where the arms point, how far
 * the player leaned, stepped, ducked) and scores each PULSE move against it.
 *
 * Everything here is plain maths with no browser or 3D imports, so it runs in the page and
 * in the Node tests alike. All sideways values are in MIRROR terms: negative x / "L" is the
 * left of the screen, which is the player's own left when they watch themselves like a mirror.
 */

export type Vec3 = [number, number, number];
export type MotionZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'both' | 'any';
export type TrackingSource = 'pose' | 'zones' | 'none';

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface ZoneEnergy {
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  any: number;
}

export interface LimbState {
  /** Unit direction of the upper segment (shoulder to elbow, hip to knee). x right, y up, z toward the viewer. */
  upper: Vec3;
  /** Unit direction of the lower segment (elbow to wrist, knee to ankle). */
  lower: Vec3;
  visible: boolean;
}

export interface BodyState {
  source: TrackingSource;
  t: number;
  /** Sideways step away from where the player normally stands, in shoulder widths. Negative = screen left. */
  shiftX: number;
  /** Torso lean in radians. Positive = toward screen right. */
  lean: number;
  /** Body turn in radians. Positive = screen-left shoulder comes forward. */
  twist: number;
  /** 0..1 how far the shoulders shrank compared with facing the camera (a turn or sweep). */
  turn: number;
  /** 0..1 how far the player dropped below their normal height. */
  crouch: number;
  headRoll: number;
  headYaw: number;
  armL: LimbState;
  armR: LimbState;
  legL: LimbState;
  legR: LimbState;
  /** Wrist height above the shoulder, in shoulder widths. Positive = above the shoulder. */
  handHeightL: number;
  handHeightR: number;
  /** How far the wrist is out to the side of its shoulder, in shoulder widths. */
  reachL: number;
  reachR: number;
  /** 0..1 how close the nearest hand is to the mouth. */
  handToFace: number;
  /** Fastest hand, in shoulder widths per second. */
  handSpeed: number;
  /** 0..1 a hand moving quickly up/down in front of the body (a strum). */
  strum: number;
  /** 0..1 one foot lifted or moving fast. Only meaningful when legsVisible. */
  footLift: number;
  hipsVisible: boolean;
  legsVisible: boolean;
  /** 0..1 how much the whole body is moving. */
  energy: number;
}

export interface CueDefinition {
  id: string;
  label: string;
  short: string;
  zone: MotionZone;
  /** Shown under the move name so the player knows what the camera is looking for. */
  hint: string;
}

/** Same twelve moves and zones as v0.1.x, so exported events stay compatible. */
export const CUES: CueDefinition[] = [
  { id: 'step-left', label: 'Step left', short: 'LEFT', zone: 'left', hint: 'Step or slide to your left' },
  { id: 'step-right', label: 'Step right', short: 'RIGHT', zone: 'right', hint: 'Step or slide to your right' },
  { id: 'grab-high', label: 'Grab it', short: 'GRAB', zone: 'top', hint: 'Reach a hand up high' },
  { id: 'kick', label: 'Kick', short: 'KICK', zone: 'bottom', hint: 'Kick or lift a foot' },
  { id: 'point-left', label: 'Point left', short: 'POINT', zone: 'left', hint: 'Left arm straight out to the side' },
  { id: 'duck', label: 'Duck', short: 'DUCK', zone: 'bottom', hint: 'Drop down, bend your knees' },
  { id: 'turn', label: 'Turn / sweep', short: 'TURN', zone: 'both', hint: 'Turn your shoulders side-on' },
  { id: 'lean-right', label: 'Lean right', short: 'LEAN', zone: 'right', hint: 'Tip your shoulders to the right' },
  { id: 'throw', label: 'Throw it', short: 'THROW', zone: 'top', hint: 'Fast hand, up by your shoulder' },
  { id: 'guitar-hit', label: 'Guitar hit', short: 'HIT', zone: 'center', hint: 'Strum hard across your body' },
  { id: 'mic-grab', label: 'Grab the mic', short: 'MIC', zone: 'center', hint: 'Bring a hand up to your mouth' },
  { id: 'free', label: 'Free move', short: 'FREE', zone: 'any', hint: 'Anything, just move' },
];

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** 0 below `from`, 1 above `to`, straight line between. */
export const ramp = (value: number, from: number, to: number) => clamp((value - from) / (to - from), 0, 1);

const norm = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-6 ? [v[0] / length, v[1] / length, v[2] / length] : [0, -1, 0];
};

export const REST_ARM_L: LimbState = { upper: norm([-0.2, -1, 0.04]), lower: norm([-0.08, -1, 0.22]), visible: false };
export const REST_ARM_R: LimbState = { upper: norm([0.2, -1, 0.04]), lower: norm([0.08, -1, 0.22]), visible: false };
export const REST_LEG_L: LimbState = { upper: norm([-0.07, -1, 0.02]), lower: norm([0.0, -1, -0.02]), visible: false };
export const REST_LEG_R: LimbState = { upper: norm([0.07, -1, 0.02]), lower: norm([0.0, -1, -0.02]), visible: false };

export function restBody(t = 0, source: TrackingSource = 'none'): BodyState {
  return {
    source, t,
    shiftX: 0, lean: 0, twist: 0, turn: 0, crouch: 0, headRoll: 0, headYaw: 0,
    armL: REST_ARM_L, armR: REST_ARM_R, legL: REST_LEG_L, legR: REST_LEG_R,
    handHeightL: -1.6, handHeightR: -1.6, reachL: 0.1, reachR: 0.1,
    handToFace: 0, handSpeed: 0, strum: 0, footLift: 0,
    hipsVisible: false, legsVisible: false, energy: 0,
  };
}

// MediaPipe pose landmark numbers. "L" here is the PLAYER'S left, which lands on screen left in a mirror view.
const NOSE = 0, EYE_L = 2, EYE_R = 5, EAR_L = 7, EAR_R = 8, MOUTH_L = 9, MOUTH_R = 10;
const SHOULDER_L = 11, SHOULDER_R = 12, ELBOW_L = 13, ELBOW_R = 14, WRIST_L = 15, WRIST_R = 16;
const HIP_L = 23, HIP_R = 24, KNEE_L = 25, KNEE_R = 26, ANKLE_L = 27, ANKLE_R = 28;
const USED = [NOSE, EYE_L, EYE_R, EAR_L, EAR_R, MOUTH_L, MOUTH_R, SHOULDER_L, SHOULDER_R, ELBOW_L, ELBOW_R,
  WRIST_L, WRIST_R, HIP_L, HIP_R, KNEE_L, KNEE_R, ANKLE_L, ANKLE_R];

interface P { x: number; y: number; z: number; v: number }

/**
 * Keeps a little history (where the player normally stands, how fast the hands move) so one
 * frame of landmarks becomes a steady body state. Make one per camera session.
 */
export class BodyTracker {
  private points: Array<P | undefined> = [];
  private lastT = 0;
  private base: { x: number; y: number; s: number; w: number } | null = null;
  private prev: Record<number, { x: number; y: number }> = {};
  private speed: Record<number, { vx: number; vy: number }> = {};
  private energy = 0;

  reset() {
    this.points = [];
    this.lastT = 0;
    this.base = null;
    this.prev = {};
    this.speed = {};
    this.energy = 0;
  }

  /**
   * @param landmarks 33 normalised pose landmarks straight from MediaPipe (not mirrored)
   * @param t timestamp in ms
   * @param aspect camera width / height, so sideways and up/down distances compare fairly
   */
  update(landmarks: Landmark[], t: number, aspect = 4 / 3): BodyState | null {
    if (!landmarks || landmarks.length < 29) return null;
    const dt = this.lastT ? clamp((t - this.lastT) / 1000, 0.001, 0.25) : 0.033;
    const fresh = !this.lastT || t - this.lastT > 600;
    this.lastT = t;

    // Mirror, square up the units, and smooth out the frame-to-frame jitter.
    const blend = fresh ? 1 : 1 - Math.exp(-dt / 0.045);
    for (const i of USED) {
      const raw = landmarks[i];
      if (!raw) continue;
      const next: P = { x: (1 - raw.x) * aspect, y: raw.y, z: raw.z * aspect, v: raw.visibility ?? 1 };
      const old = this.points[i];
      this.points[i] = old && !fresh
        ? { x: old.x + (next.x - old.x) * blend, y: old.y + (next.y - old.y) * blend, z: old.z + (next.z - old.z) * blend, v: next.v }
        : next;
    }
    const p = (i: number) => this.points[i] as P;
    const seen = (...ids: number[]) => ids.every(i => (this.points[i]?.v ?? 0) > 0.5);
    if (!this.points[SHOULDER_L] || !this.points[SHOULDER_R]) return null;
    if (p(SHOULDER_L).v < 0.35 && p(SHOULDER_R).v < 0.35) return null;

    const sL = p(SHOULDER_L), sR = p(SHOULDER_R);
    const mid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
    const shoulderWidth = Math.hypot(sR.x - sL.x, sR.y - sL.y);
    const hipsVisible = seen(HIP_L, HIP_R);
    const hipMid = hipsVisible ? { x: (p(HIP_L).x + p(HIP_R).x) / 2, y: (p(HIP_L).y + p(HIP_R).y) / 2 } : null;
    const torso = hipMid ? Math.hypot(hipMid.x - mid.x, hipMid.y - mid.y) : 0;
    // Body size. Shoulders shrink when you turn side-on, so the torso length backs them up.
    const size = Math.max(shoulderWidth, torso * 0.62, 0.02);

    // How fast each tracked point is moving, in body sizes per second.
    const speedOf = (i: number) => {
      const point = this.points[i];
      if (!point || point.v < 0.5) { delete this.prev[i]; return { vx: 0, vy: 0, mag: 0 }; }
      const before = this.prev[i];
      this.prev[i] = { x: point.x, y: point.y };
      if (!before || fresh) { this.speed[i] = { vx: 0, vy: 0 }; return { vx: 0, vy: 0, mag: 0 }; }
      const vx = (point.x - before.x) / dt / size;
      const vy = (point.y - before.y) / dt / size;
      const old = this.speed[i] || { vx: 0, vy: 0 };
      const k = 1 - Math.exp(-dt / 0.07);
      const smooth = { vx: old.vx + (vx - old.vx) * k, vy: old.vy + (vy - old.vy) * k };
      this.speed[i] = smooth;
      return { ...smooth, mag: Math.hypot(smooth.vx, smooth.vy) };
    };
    const vWristL = speedOf(WRIST_L), vWristR = speedOf(WRIST_R);
    const vShoulderL = speedOf(SHOULDER_L), vShoulderR = speedOf(SHOULDER_R);
    const vAnkleL = speedOf(ANKLE_L), vAnkleR = speedOf(ANKLE_R);
    const legsVisible = hipsVisible && seen(KNEE_L, KNEE_R, ANKLE_L, ANKLE_R);
    const moving = (vWristL.mag + vWristR.mag) * 0.3 + (vShoulderL.mag + vShoulderR.mag) * 0.5 +
      (legsVisible ? (vAnkleL.mag + vAnkleR.mag) * 0.25 : 0);
    this.energy += (clamp(moving / 2.4, 0, 1) - this.energy) * (1 - Math.exp(-dt / 0.12));

    // "Normal" standing spot. It follows the player quickly when they hold still and slowly while they move.
    if (!this.base || fresh) this.base = { x: mid.x, y: mid.y, s: size, w: shoulderWidth };
    const calm = (vShoulderL.mag + vShoulderR.mag) / 2 < 0.25;
    const follow = 1 - Math.exp(-dt / (calm ? 2.2 : 9));
    const shiftX = (mid.x - this.base.x) / this.base.s;
    const drop = (mid.y - this.base.y) / this.base.s;
    // A turn shows up as the shoulders getting narrower than they normally look to the camera.
    const turn = ramp(1 - shoulderWidth / Math.max(this.base.w, 0.01), 0.18, 0.55);
    this.base.x += (mid.x - this.base.x) * follow;
    this.base.y += (mid.y - this.base.y) * follow;
    this.base.s += (size - this.base.s) * follow;
    // Shoulder width is relearned quickly when it grows (you squared up or stepped closer) and only
    // slowly when it shrinks, so a held turn does not become the new normal within a move or two.
    this.base.w += (shoulderWidth - this.base.w) * (shoulderWidth > this.base.w ? follow : follow * 0.15);

    const lean = hipMid
      ? Math.atan2(mid.x - hipMid.x, hipMid.y - mid.y)
      : Math.atan2(sR.y - sL.y, sR.x - sL.x) * 0.9;
    const twist = clamp(Math.atan2(sR.z - sL.z, Math.max(sR.x - sL.x, 0.01)), -0.9, 0.9);

    const dir = (from: number, to: number): Vec3 => {
      const a = p(from), b = p(to);
      // Image y runs down and z runs away from the camera; the avatar's y runs up and z toward the viewer.
      return norm([b.x - a.x, -(b.y - a.y), -(b.z - a.z) * 0.6]);
    };
    const limb = (a: number, b: number, c: number, rest: LimbState): LimbState =>
      seen(b) && (this.points[a]?.v ?? 0) > 0.35
        ? { upper: dir(a, b), lower: seen(c) ? dir(b, c) : dir(a, b), visible: true }
        : rest;
    const armL = limb(SHOULDER_L, ELBOW_L, WRIST_L, REST_ARM_L);
    const armR = limb(SHOULDER_R, ELBOW_R, WRIST_R, REST_ARM_R);
    const legL = legsVisible ? limb(HIP_L, KNEE_L, ANKLE_L, REST_LEG_L) : REST_LEG_L;
    const legR = legsVisible ? limb(HIP_R, KNEE_R, ANKLE_R, REST_LEG_R) : REST_LEG_R;

    const wristSeenL = seen(WRIST_L), wristSeenR = seen(WRIST_R);
    const handHeightL = wristSeenL ? (sL.y - p(WRIST_L).y) / size : -1.6;
    const handHeightR = wristSeenR ? (sR.y - p(WRIST_R).y) / size : -1.6;
    const reachL = wristSeenL ? (sL.x - p(WRIST_L).x) / size : 0;
    const reachR = wristSeenR ? (p(WRIST_R).x - sR.x) / size : 0;

    let handToFace = 0;
    if (this.points[MOUTH_L] && this.points[MOUTH_R]) {
      const mouth = { x: (p(MOUTH_L).x + p(MOUTH_R).x) / 2, y: (p(MOUTH_L).y + p(MOUTH_R).y) / 2 };
      for (const [wrist, ok] of [[WRIST_L, wristSeenL], [WRIST_R, wristSeenR]] as Array<[number, boolean]>) {
        if (!ok) continue;
        const d = Math.hypot(p(wrist).x - mouth.x, p(wrist).y - mouth.y) / size;
        handToFace = Math.max(handToFace, 1 - ramp(d, 0.3, 0.8));
      }
    }

    // A strum: a hand in front of the chest or belly, moving fast up or down.
    const bellyY = hipMid ? hipMid.y + size * 0.15 : mid.y + size * 1.75;
    const inFront = (wrist: number, ok: boolean) => ok &&
      p(wrist).x > sL.x - size * 0.25 && p(wrist).x < sR.x + size * 0.25 &&
      p(wrist).y > mid.y + size * 0.1 && p(wrist).y < bellyY;
    const strum = Math.max(
      inFront(WRIST_L, wristSeenL) ? ramp(Math.abs(vWristL.vy), 0.9, 2.8) : 0,
      inFront(WRIST_R, wristSeenR) ? ramp(Math.abs(vWristR.vy), 0.9, 2.8) : 0,
    );

    let footLift = 0;
    if (legsVisible) {
      const lifted = Math.abs(p(ANKLE_L).y - p(ANKLE_R).y) / size;
      footLift = Math.max(ramp(lifted, 0.12, 0.5), ramp(Math.max(vAnkleL.mag, vAnkleR.mag), 1.1, 3.2));
    }

    let headRoll = 0, headYaw = 0;
    if (seen(EYE_L, EYE_R)) headRoll = clamp(Math.atan2(p(EYE_R).y - p(EYE_L).y, p(EYE_R).x - p(EYE_L).x), -0.6, 0.6);
    if (seen(EAR_L, EAR_R, NOSE)) {
      const earMid = (p(EAR_L).x + p(EAR_R).x) / 2;
      const earGap = Math.max(Math.abs(p(EAR_R).x - p(EAR_L).x), size * 0.12);
      headYaw = clamp(((p(NOSE).x - earMid) / earGap) * 1.5, -0.8, 0.8);
    }

    return {
      source: 'pose', t,
      shiftX: clamp(shiftX, -1.5, 1.5),
      lean: clamp(lean, -0.7, 0.7),
      twist, turn,
      crouch: ramp(drop, 0.1, 0.55),
      headRoll, headYaw,
      armL, armR, legL, legR,
      handHeightL, handHeightR, reachL, reachR,
      handToFace,
      handSpeed: Math.max(vWristL.mag, vWristR.mag),
      strum, footLift,
      hipsVisible, legsVisible,
      energy: this.energy,
    };
  }
}

const zoneLevel = (value: number) => clamp(value * 6.5, 0, 1);

/**
 * Stand-in body state for when body tracking is not available: the avatar leans, lifts its
 * arms and bounces with the amount of movement in each part of the picture.
 */
export function bodyFromZones(zones: ZoneEnergy, t: number): BodyState {
  const left = zoneLevel(zones.left), right = zoneLevel(zones.right);
  const up = zoneLevel(zones.top), down = zoneLevel(zones.bottom);
  const side = right - left;
  const raise = (extra: number) => clamp(up * 1.1 + extra * 0.5, 0, 1) * 2.0;
  const arm = (sign: number, angle: number): LimbState => ({
    upper: norm([sign * Math.sin(0.2 + angle), -Math.cos(0.2 + angle), 0.05]),
    lower: norm([sign * Math.sin(0.1 + angle * 1.25), -Math.cos(0.1 + angle * 1.25), 0.2]),
    visible: true,
  });
  return {
    ...restBody(t, 'zones'),
    shiftX: side * 0.5,
    lean: side * 0.3,
    crouch: clamp(down * 0.8, 0, 1),
    armL: arm(-1, raise(left)),
    armR: arm(1, raise(right)),
    energy: zoneLevel(zones.any),
  };
}

export function cueEnergy(zones: ZoneEnergy, zone: MotionZone): number {
  if (zone === 'both') return (zones.left + zones.right) / 2;
  if (zone === 'any') return zones.any;
  return zones[zone];
}

/** v0.1.x movement threshold: more sensitivity and more assist both ask for less movement. */
export function zoneThreshold(sensitivity: number, assist: number): number {
  return clamp(0.15 - (sensitivity / 100) * 0.08 - (assist / 100) * 0.035, 0.03, 0.15);
}

export function zoneStrength(zones: ZoneEnergy, zone: MotionZone, threshold: number): number {
  return clamp((cueEnergy(zones, zone) - threshold) / Math.max(0.18 - threshold, 0.04), 0, 1);
}

/**
 * 0..1: how clearly the player is doing this move right now. With body tracking it checks the
 * actual shape of the move; without it (or when the needed body part is out of frame) it falls
 * back to the v0.1.x "movement in that part of the picture" check.
 */
export function cueStrength(cue: CueDefinition, body: BodyState, zones: ZoneEnergy, threshold: number): number {
  const byZone = () => zoneStrength(zones, cue.zone, threshold);
  if (body.source !== 'pose') return byZone();
  switch (cue.id) {
    case 'step-left': return ramp(-body.shiftX, 0.15, 0.5);
    case 'step-right': return ramp(body.shiftX, 0.15, 0.5);
    case 'lean-right': return ramp(body.lean, 0.08, 0.26);
    case 'grab-high': return ramp(Math.max(body.handHeightL, body.handHeightR), 0.15, 0.7);
    case 'point-left': return body.armL.visible
      ? ramp(body.reachL, 0.6, 1.15) * (Math.abs(body.handHeightL) < 0.65 ? 1 : 0.35)
      : 0;
    case 'throw': return ramp(body.handSpeed, 1.2, 3.4) * (Math.max(body.handHeightL, body.handHeightR) > -0.25 ? 1 : 0.3);
    case 'duck': return ramp(body.crouch, 0.2, 0.75);
    case 'turn': return body.turn;
    case 'guitar-hit': return body.strum;
    case 'mic-grab': return body.handToFace;
    case 'kick': return body.legsVisible ? body.footLift : byZone();
    case 'free': return ramp(body.energy, 0.08, 0.45);
    default: return byZone();
  }
}

/** A shuffled run of moves with no move twice in a row. Same seed, same run. */
export function buildCueOrder(count: number, seed = 1, pool: CueDefinition[] = CUES): CueDefinition[] {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  const order: CueDefinition[] = [];
  let bag: CueDefinition[] = [];
  while (order.length < count) {
    if (!bag.length) {
      bag = pool.slice();
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (order.length && bag.length > 1 && bag[bag.length - 1].id === order[order.length - 1].id) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
    }
    order.push(bag.pop() as CueDefinition);
  }
  return order;
}

export type Grade = 'perfect' | 'nice' | 'close' | 'miss';

export interface CueScore {
  score: number;
  timingScore: number;
  movementScore: number;
  energyScore: number;
  timingErrorMs: number | null;
  grade: Grade;
}

export const gradeOf = (score: number): Grade =>
  score >= 85 ? 'perfect' : score >= 65 ? 'nice' : score >= 40 ? 'close' : 'miss';

/**
 * @param peakStrength best 0..1 match seen inside the move's window
 * @param bestErrorMs closest the player came to the beat while clearly doing the move, or null if never
 * @param peakEnergy 0..1 most the body moved inside the window
 * @param assist 0..100 forgiveness
 */
export function scoreCue(peakStrength: number, bestErrorMs: number | null, peakEnergy: number, assist: number): CueScore {
  const timingWindow = 190 + assist * 3.1;
  const timingScore = bestErrorMs === null ? 0 : Math.round(clamp(100 - (bestErrorMs / timingWindow) * 100, 0, 100));
  const movementScore = Math.round(clamp(peakStrength * (1 + assist / 250), 0, 1) * 100);
  const energyScore = Math.round(clamp(peakEnergy, 0, 1) * 100);
  // Timing and the move itself decide the score; energy is a small bonus on top, never a penalty.
  const score = Math.round(clamp(timingScore * 0.5 + movementScore * 0.42 + energyScore * 0.08 +
    (timingScore > 0 && movementScore >= 90 ? 4 : 0), 0, 100));
  return { score, timingScore, movementScore, energyScore, timingErrorMs: bestErrorMs === null ? null : Math.round(bestErrorMs), grade: gradeOf(score) };
}

/** Lines to draw between landmarks for the on-camera skeleton. */
export const SKELETON_LINES: Array<[number, number]> = [
  [SHOULDER_L, SHOULDER_R], [SHOULDER_L, ELBOW_L], [ELBOW_L, WRIST_L], [SHOULDER_R, ELBOW_R], [ELBOW_R, WRIST_R],
  [SHOULDER_L, HIP_L], [SHOULDER_R, HIP_R], [HIP_L, HIP_R], [HIP_L, KNEE_L], [KNEE_L, ANKLE_L], [HIP_R, KNEE_R], [KNEE_R, ANKLE_R],
];
