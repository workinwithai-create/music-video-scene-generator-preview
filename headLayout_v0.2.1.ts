/**
 * My Character head v0.2.1: turns the 468 face landmarks from a selfie into one complete head.
 *
 * What v0.2.0 got wrong, and what this does instead:
 *  - It stretched the photo over the landmarks exactly as they lay in the picture, so a selfie taken
 *    from below or with the head turned gave a face that pointed off to one side. Here the face is
 *    first turned to look straight ahead, using the landmarks' own depth.
 *  - It ignored that the selfie is taller than it is wide, which squashed every face by a fifth.
 *  - It laid the face over a separate ball. The ball poked through the cheeks and forehead (the
 *    "holes") and the face edge hovered in front of it. Here the back of the head is grown out of
 *    the face's own edge, so skin and face are one surface.
 *
 * Plain maths only (no 3D library), so it runs in the page and in the tests.
 * Head space: x to the viewer's right, y up, z toward the viewer. Face half-width is about 0.9.
 */
import { CANONICAL_FACE, FACE_OVAL, FACE_TRIANGLES } from './faceData_v0.2.1.ts';

export type FacePoint = [number, number, number];
export type Vec3 = [number, number, number];

/** The character editor always stores the selfie as 480 x 600. */
export const SELFIE_ASPECT = 480 / 600;
export const FACE_HALF_WIDTH = 0.9;
const VERTS = 468;
const RING = FACE_OVAL.length;
const FRONT_STEPS = 6;
const BACK_STEPS = 8;

/** Slider values in percent (100 = unchanged), same meaning as in v0.2.0. */
export interface FaceMorph {
  jawWidth?: number;
  cheekWidth?: number;
  noseWidth?: number;
  noseDepth?: number;
  eyeSpacing?: number;
  faceWidth?: number;
  faceLength?: number;
}

export type HairStyle = 'photo' | 'short' | 'long' | 'slick' | 'cap';

export interface HeadLayout {
  /** True when built from a selfie scan, false for the built-in neutral face. */
  scanned: boolean;
  /** Every vertex of the head skin: the 468 face landmarks first, then the back of the head. */
  positions: Float32Array;
  /** Triangles of the whole head skin (face and back of head together). */
  skinIndices: number[];
  /** Triangles of the face alone, for laying the photo on top. */
  faceIndices: number[];
  /** Photo coordinates for the 468 face vertices (null for the neutral face). */
  faceUv: Float32Array | null;
  /** 0..1 per face vertex: how strongly the photo shows. Fades to 0 at the edge so it melts into the skin. */
  faceAlpha: Float32Array;
  /** Hair shell: its own vertices (the head skin pushed outward) and triangles. */
  hairPositions: Float32Array;
  hairIndices: number[];
  /** Useful spots, all in head space. */
  top: number;
  chin: number;
  crown: number;
  halfWidth: number;
  earY: number;
  earZ: number;
  backZ: number;
  eyes: [Vec3, Vec3];
  brows: [Vec3, Vec3];
  mouth: Vec3;
  noseTip: Vec3;
  chinPoint: Vec3;
  foreheadPoint: Vec3;
  /** Where the neck meets the head: under the middle of the skull. */
  neck: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number, from: number, to: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** The neutral face as camera-style points (x right, y down, z away), so it goes through the same steps as a scan. */
function canonicalPoints(): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < VERTS; i += 1) out.push([CANONICAL_FACE[i * 3], -CANONICAL_FACE[i * 3 + 1], -CANONICAL_FACE[i * 3 + 2]]);
  return out;
}

const centreOf = (points: Vec3[], ids: number[]): Vec3 => {
  const sum: Vec3 = [0, 0, 0];
  for (const i of ids) { sum[0] += points[i][0]; sum[1] += points[i][1]; sum[2] += points[i][2]; }
  return [sum[0] / ids.length, sum[1] / ids.length, sum[2] / ids.length];
};

/**
 * @param facePoints 468 landmarks from the selfie scan (x and y as fractions of the picture, z in the
 *   same scale as x), or null for the neutral face
 * @param morph the editor's face sliders
 * @param hair which hair shell to build
 * @param aspect picture width / height
 */
export function layoutHead(
  facePoints: FacePoint[] | null | undefined,
  morph: FaceMorph = {},
  hair: HairStyle = 'short',
  aspect: number = SELFIE_ASPECT,
): HeadLayout {
  let scanned = !!facePoints && facePoints.length >= VERTS;
  // Square up the units: a tall picture's x and z fractions cover less distance than its y fractions.
  let source: Vec3[] = scanned
    ? (facePoints as FacePoint[]).slice(0, VERTS).map(p => [p[0] * aspect, p[1], p[2] * aspect])
    : canonicalPoints();

  const frame = (points: Vec3[]) => {
    const left = points[234], right = points[454], top = points[10], chin = points[152];
    const ex = unit(sub(right, left));
    const ez = unit(cross(ex, sub(chin, top))); // straight out the back of the head
    const ey = cross(ez, ex); // down the face
    const centre: Vec3 = [
      (left[0] + right[0] + top[0] + chin[0]) / 4, (left[1] + right[1] + top[1] + chin[1]) / 4, (left[2] + right[2] + top[2] + chin[2]) / 4,
    ];
    const halfW = Math.hypot(...sub(right, left)) / 2;
    const halfH = dot(sub(chin, top), ey) / 2;
    return { ex, ey, ez, centre, halfW, halfH };
  };
  let f = frame(source);
  // A scan too broken to measure (no width, no height, not a number) falls back to the neutral face.
  if (!(f.halfW > 1e-4) || !(f.halfH > 1e-4) || !Number.isFinite(f.halfW + f.halfH)) {
    scanned = false;
    source = canonicalPoints();
    f = frame(source);
  }

  const scale = FACE_HALF_WIDTH / f.halfW;
  const pct = (value: number | undefined) => (Number.isFinite(value) ? (value as number) / 100 : 1);
  const jaw = pct(morph.jawWidth), cheek = pct(morph.cheekWidth), noseW = pct(morph.noseWidth), noseD = pct(morph.noseDepth);
  const eyeGap = pct(morph.eyeSpacing), wide = pct(morph.faceWidth), long = pct(morph.faceLength);

  // 1. The face itself: turned to face straight ahead, in true proportion, with the sliders applied.
  const face: Vec3[] = source.map(p => {
    const d = sub(p, f.centre);
    const u = dot(d, f.ex), v = dot(d, f.ey), w = dot(d, f.ez);
    const dx = u / f.halfW, dy = v / f.halfH;
    const lower = smoothstep(dy, -0.15, 0.88);
    const cheekF = Math.exp(-Math.pow((dy - 0.05) / 0.36, 2));
    const noseF = Math.exp(-Math.pow(dx / 0.34, 2) - Math.pow((dy - 0.08) / 0.4, 2));
    const eyeF = Math.exp(-Math.pow((dy + 0.2) / 0.22, 2));
    const x = u * scale * wide * (1 + (jaw - 1) * lower + (cheek - 1) * cheekF) * (1 + (noseW - 1) * noseF + (eyeGap - 1) * eyeF);
    return [x, -v * scale * long, -w * scale + (noseD - 1) * noseF * 0.48];
  });

  const top = face[10][1], chin = face[152][1], height = top - chin;
  const halfWidth = Math.max(Math.abs(face[234][0]), Math.abs(face[454][0]));
  const earY = (face[234][1] + face[454][1]) / 2;
  const earZ = (face[234][2] + face[454][2]) / 2;

  // 2. The back of the head, grown out of the face's own edge so there is no seam and nothing to poke through.
  //    Real heads are about 1.3 times as long (front to back) as wide, with the ears near the middle.
  const crown = top + height * 0.2;
  const equatorZ = earZ - 0.12;
  const backZ = equatorZ - halfWidth * 1.32;
  const radiusX = halfWidth * 1.05;
  const radiusUp = crown - earY;
  const radiusDown = (earY - chin) * 0.5;

  const positions: number[] = [];
  for (const p of face) positions.push(p[0], p[1], p[2]);
  const ringIndex: number[][] = [FACE_OVAL.slice()];
  const dirs: Array<{ dx: number; dy: number; ex: number; ey: number }> = FACE_OVAL.map(i => {
    const vx = face[i][0], vy = face[i][1] - earY;
    const length = Math.hypot(vx, vy) || 1;
    const dx = vx / length, dy = vy / length;
    const ry = dy >= 0 ? radiusUp : radiusDown;
    const radius = 1 / Math.sqrt(Math.pow(dx / radiusX, 2) + Math.pow(dy / ry, 2));
    return { dx, dy, ex: dx * radius, ey: earY + dy * radius };
  });
  for (let step = 1; step <= FRONT_STEPS; step += 1) {
    const s = (step / FRONT_STEPS) * Math.PI / 2;
    const row: number[] = [];
    FACE_OVAL.forEach((vertex, k) => {
      const v = face[vertex], d = dirs[k];
      // Above the ears the skin swings outward first and then back (forehead to crown). Below them it runs
      // back first and then up (under the jaw to the nape).
      const upper = smoothstep(d.dy, -0.35, 0.25);
      const outward = mix(1 - Math.cos(s), Math.sin(s), upper);
      const backward = mix(Math.sin(s), 1 - Math.cos(s), upper);
      row.push(positions.length / 3);
      positions.push(mix(v[0], d.ex, outward), mix(v[1], d.ey, outward), mix(v[2], Math.min(equatorZ, v[2]), backward));
    });
    ringIndex.push(row);
  }
  for (let step = 1; step < BACK_STEPS; step += 1) {
    const s = (step / BACK_STEPS) * Math.PI / 2;
    const row: number[] = [];
    dirs.forEach(d => {
      row.push(positions.length / 3);
      positions.push(d.ex * Math.cos(s), mix(earY, d.ey, Math.cos(s)), mix(equatorZ, backZ, Math.sin(s)));
    });
    ringIndex.push(row);
  }
  const pole = positions.length / 3;
  positions.push(0, earY, backZ);

  const headCentre: Vec3 = [0, earY, equatorZ];
  const at = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const skinIndices: number[] = FACE_TRIANGLES.slice();
  const shellQuads: Array<[number, number, number, number, number, number]> = []; // a b c d, ring number, slot
  // Make every skull triangle face outward, whichever way round the edge landmarks happen to run.
  const pushFacing = (target: number[], a: number, b: number, c: number) => {
    const pa = at(a), normal = cross(sub(at(b), pa), sub(at(c), pa));
    const mid: Vec3 = [(pa[0] + at(b)[0] + at(c)[0]) / 3, (pa[1] + at(b)[1] + at(c)[1]) / 3, (pa[2] + at(b)[2] + at(c)[2]) / 3];
    if (dot(normal, sub(mid, headCentre)) >= 0) target.push(a, b, c); else target.push(a, c, b);
  };
  for (let r = 0; r + 1 < ringIndex.length; r += 1) {
    for (let k = 0; k < RING; k += 1) {
      const n = (k + 1) % RING;
      const a = ringIndex[r][k], b = ringIndex[r][n], c = ringIndex[r + 1][n], d = ringIndex[r + 1][k];
      pushFacing(skinIndices, a, b, c);
      pushFacing(skinIndices, a, c, d);
      shellQuads.push([a, b, c, d, r, k]);
    }
  }
  const last = ringIndex[ringIndex.length - 1];
  for (let k = 0; k < RING; k += 1) pushFacing(skinIndices, last[k], last[(k + 1) % RING], pole);

  // 3. Photo fade: full strength across the face, melting into plain skin at the very edge.
  const faceAlpha = new Float32Array(VERTS).fill(1);
  const onEdge = new Set(FACE_OVAL);
  const nearEdge = new Set<number>();
  for (let i = 0; i < FACE_TRIANGLES.length; i += 3) {
    const tri = [FACE_TRIANGLES[i], FACE_TRIANGLES[i + 1], FACE_TRIANGLES[i + 2]];
    if (tri.some(v => onEdge.has(v))) tri.forEach(v => { if (!onEdge.has(v)) nearEdge.add(v); });
  }
  nearEdge.forEach(v => { faceAlpha[v] = 0.82; });
  onEdge.forEach(v => { faceAlpha[v] = 0; });

  let faceUv: Float32Array | null = null;
  if (scanned) {
    faceUv = new Float32Array(VERTS * 2);
    (facePoints as FacePoint[]).slice(0, VERTS).forEach((p, i) => { faceUv![i * 2] = p[0]; faceUv![i * 2 + 1] = 1 - p[1]; });
  }

  // 4. Hair: the same skin pushed outward, covering the top and back and leaving the face and neck clear.
  const lift = hair === 'long' ? 0.1 : hair === 'slick' ? 0.035 : hair === 'cap' ? 0.075 : 0.065;
  const hairPositions = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i += 1) {
    const p = at(i);
    const away = unit(sub(p, headCentre));
    hairPositions[i * 3] = p[0] + away[0] * lift;
    hairPositions[i * 3 + 1] = p[1] + away[1] * lift + (i < VERTS ? 0.01 : 0);
    hairPositions[i * 3 + 2] = p[2] + away[2] * lift + (i < VERTS ? 0.03 : 0);
  }
  const hairIndices: number[] = [];
  const hairline = hair === 'long' ? -0.55 : -0.2; // how far down the sides and back the hair comes
  const covered = (ring: number, slot: number) => {
    const dy = dirs[slot].dy;
    if (ring === 0) return dy > 0.62; // across the top of the forehead only
    if (ring <= FRONT_STEPS) return dy > mix(0.3, hairline, ring / FRONT_STEPS); // sweeps down past the temples
    return dy > hairline - 0.35; // back of the head, down toward the nape
  };
  for (const [a, b, c, d, r, k] of shellQuads) {
    const n = (k + 1) % RING;
    if (!(covered(r, k) && covered(r, n) && covered(r + 1, k) && covered(r + 1, n))) continue;
    for (const [p, q, s] of [[a, b, c], [a, c, d]] as Array<[number, number, number]>) {
      const pa = at(p), normal = cross(sub(at(q), pa), sub(at(s), pa));
      if (dot(normal, sub(pa, headCentre)) >= 0) hairIndices.push(p, q, s); else hairIndices.push(p, s, q);
    }
  }
  for (let k = 0; k < RING; k += 1) {
    if (dirs[k].dy > hairline - 0.35 && dirs[(k + 1) % RING].dy > hairline - 0.35) pushFacing(hairIndices, last[k], last[(k + 1) % RING], pole);
  }

  return {
    scanned,
    positions: new Float32Array(positions),
    skinIndices,
    faceIndices: FACE_TRIANGLES.slice(),
    faceUv,
    faceAlpha,
    hairPositions,
    hairIndices,
    top, chin, crown, halfWidth, earY, earZ, backZ,
    eyes: [centreOf(face, [33, 133, 159, 145]), centreOf(face, [362, 263, 386, 374])],
    brows: [centreOf(face, [70, 105, 107]), centreOf(face, [300, 334, 336])],
    mouth: centreOf(face, [13, 14]),
    noseTip: face[1],
    chinPoint: face[152],
    foreheadPoint: face[10],
    neck: [0, chin + height * 0.12, equatorZ + 0.1],
  };
}
