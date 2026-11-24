// Run with: npm test   (Node 22.18+ runs TypeScript directly; no extra packages needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BodyTracker, CUES, bodyFromZones, buildCueOrder, cueStrength, scoreCue, zoneThreshold,
  type BodyState, type Landmark, type ZoneEnergy,
} from '../pulseTracking_v0.2.0.ts';

const QUIET: ZoneEnergy = { left: 0, right: 0, top: 0, bottom: 0, center: 0, any: 0 };
const cue = (id: string) => CUES.find(c => c.id === id)!;
const TH = zoneThreshold(65, 35);

/**
 * A person standing square to the camera, in raw (un-mirrored) camera coordinates.
 * The player's LEFT side is on the RIGHT of the raw picture (larger x), as a camera sees it.
 */
function standing(): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const set = (i: number, x: number, y: number) => { lm[i] = { x, y, z: 0, visibility: 0.99 }; };
  set(0, 0.5, 0.24);                       // nose
  set(2, 0.52, 0.225); set(5, 0.48, 0.225); // eyes (player's left, right)
  set(7, 0.545, 0.235); set(8, 0.455, 0.235); // ears
  set(9, 0.515, 0.265); set(10, 0.485, 0.265); // mouth
  set(11, 0.59, 0.35); set(12, 0.41, 0.35); // shoulders
  set(13, 0.61, 0.49); set(14, 0.39, 0.49); // elbows
  set(15, 0.615, 0.62); set(16, 0.385, 0.62); // wrists
  set(23, 0.56, 0.62); set(24, 0.44, 0.62); // hips
  set(25, 0.565, 0.8); set(26, 0.435, 0.8); // knees
  set(27, 0.57, 0.96); set(28, 0.43, 0.96); // ankles
  return lm;
}

const clone = (lm: Landmark[]) => lm.map(p => ({ ...p }));

/** Stand still for a second, then hold `pose` for `frames` frames. Returns the last body state. */
function settleThen(pose: Landmark[], frames = 6, tracker = new BodyTracker()): BodyState {
  let t = 1000;
  for (let i = 0; i < 30; i += 1) { tracker.update(standing(), t, 4 / 3); t += 33; }
  let body: BodyState | null = null;
  for (let i = 0; i < frames; i += 1) { body = tracker.update(pose, t, 4 / 3); t += 33; }
  assert.ok(body, 'tracker returned a body state');
  return body!;
}

const strengths = (body: BodyState, zones = QUIET) =>
  Object.fromEntries(CUES.map(c => [c.id, cueStrength(c, body, zones, TH)]));

test('standing still: arms hang down and no move fires', () => {
  const body = settleThen(standing());
  assert.equal(body.source, 'pose');
  assert.ok(body.armL.upper[1] < -0.9 && body.armR.upper[1] < -0.9, 'upper arms point down');
  assert.ok(body.armL.upper[0] < 0 && body.armR.upper[0] > 0, 'left arm on screen left, right arm on screen right');
  assert.ok(Math.abs(body.lean) < 0.03 && body.crouch === 0 && Math.abs(body.shiftX) < 0.03);
  for (const [id, value] of Object.entries(strengths(body))) assert.ok(value < 0.2, id + ' should be quiet, got ' + value);
});

test("raising the player's left hand lifts the screen-left arm and scores Grab it", () => {
  const pose = standing();
  pose[13] = { x: 0.62, y: 0.25, z: 0, visibility: 0.99 };
  pose[15] = { x: 0.61, y: 0.1, z: 0, visibility: 0.99 };
  const body = settleThen(pose);
  assert.ok(body.armL.upper[1] > 0.8, 'screen-left upper arm points up');
  assert.ok(body.armR.upper[1] < -0.9, 'other arm stays down');
  assert.ok(body.handHeightL > 1);
  const s = strengths(body);
  assert.ok(s['grab-high'] > 0.95);
  assert.ok(s['duck'] < 0.1 && s['step-left'] < 0.1 && s['point-left'] < 0.4);
});

test('stepping to your own left reads as Step left, not Step right', () => {
  const pose = standing().map(p => ({ ...p, x: p.x + 0.09 }));
  const s = strengths(settleThen(pose));
  assert.ok(s['step-left'] > 0.8, 'step-left ' + s['step-left']);
  assert.equal(s['step-right'], 0);
  const other = strengths(settleThen(standing().map(p => ({ ...p, x: p.x - 0.09 }))));
  assert.ok(other['step-right'] > 0.8 && other['step-left'] === 0);
});

test('where the player stands is relearned, so a step does not stay "on" forever', () => {
  const tracker = new BodyTracker();
  const pose = standing().map(p => ({ ...p, x: p.x + 0.09 }));
  const body = settleThen(pose, 400, tracker); // about 13 seconds standing in the new spot
  assert.ok(cueStrength(cue('step-left'), body, QUIET, TH) < 0.1);
});

test('dropping down scores Duck', () => {
  const pose = standing().map((p, i) => (i <= 24 ? { ...p, y: p.y + 0.09 } : p));
  const s = strengths(settleThen(pose));
  assert.ok(s['duck'] > 0.7, 'duck ' + s['duck']);
  assert.ok(s['grab-high'] === 0);
});

test('left arm straight out to the side scores Point left', () => {
  const pose = standing();
  pose[13] = { x: 0.71, y: 0.35, z: 0, visibility: 0.99 };
  pose[15] = { x: 0.83, y: 0.35, z: 0, visibility: 0.99 };
  const body = settleThen(pose);
  assert.ok(body.armL.upper[0] < -0.95, 'arm points to screen left');
  const s = strengths(body);
  assert.ok(s['point-left'] > 0.95);
  assert.ok(s['grab-high'] < 0.1);
});

test('tipping the shoulders right scores Lean right; left does not', () => {
  const right = standing().map((p, i) => (i <= 16 ? { ...p, x: p.x - 0.05 } : p));
  const body = settleThen(right);
  assert.ok(body.lean > 0.2, 'lean ' + body.lean);
  assert.ok(cueStrength(cue('lean-right'), body, QUIET, TH) > 0.7);
  const left = standing().map((p, i) => (i <= 16 ? { ...p, x: p.x + 0.05 } : p));
  assert.equal(cueStrength(cue('lean-right'), settleThen(left), QUIET, TH), 0);
});

test('turning side-on (shoulders look narrow) scores Turn; a wide stance with arms out does not', () => {
  const side = standing();
  side[11] = { ...side[11], x: 0.535 }; side[12] = { ...side[12], x: 0.465 };
  assert.ok(cueStrength(cue('turn'), settleThen(side), QUIET, TH) > 0.8);
  const wide = standing();
  wide[13] = { x: 0.71, y: 0.35, z: 0, visibility: 0.99 }; wide[15] = { x: 0.83, y: 0.35, z: 0, visibility: 0.99 };
  wide[14] = { x: 0.29, y: 0.35, z: 0, visibility: 0.99 }; wide[16] = { x: 0.17, y: 0.35, z: 0, visibility: 0.99 };
  wide[25] = { x: 0.66, y: 0.8, z: 0, visibility: 0.99 }; wide[27] = { x: 0.75, y: 0.96, z: 0, visibility: 0.99 };
  wide[26] = { x: 0.34, y: 0.8, z: 0, visibility: 0.99 }; wide[28] = { x: 0.25, y: 0.96, z: 0, visibility: 0.99 };
  assert.equal(cueStrength(cue('turn'), settleThen(wide), QUIET, TH), 0);
  // Starting the camera already in that stance must not read as a turn either.
  const tracker = new BodyTracker();
  let body: BodyState | null = null;
  for (let i = 0, t = 0; i < 20; i += 1, t += 33) body = tracker.update(wide, t, 4 / 3);
  assert.equal(cueStrength(cue('turn'), body!, QUIET, TH), 0);
});

test('a hand at the mouth scores Grab the mic', () => {
  const pose = standing();
  pose[14] = { x: 0.43, y: 0.36, z: 0, visibility: 0.99 };
  pose[16] = { x: 0.49, y: 0.28, z: 0, visibility: 0.99 };
  assert.ok(cueStrength(cue('mic-grab'), settleThen(pose), QUIET, TH) > 0.9);
});

test('a fast up-and-down hand in front of the body scores Guitar hit', () => {
  const tracker = new BodyTracker();
  let t = 1000;
  for (let i = 0; i < 30; i += 1) { tracker.update(standing(), t, 4 / 3); t += 33; }
  let best = 0;
  for (let i = 0; i < 12; i += 1) {
    const pose = standing();
    pose[14] = { x: 0.42, y: 0.46, z: 0, visibility: 0.99 };
    pose[16] = { x: 0.5, y: 0.5 + 0.06 * Math.sin(i * 1.4), z: 0, visibility: 0.99 };
    const body = tracker.update(pose, t, 4 / 3)!;
    best = Math.max(best, cueStrength(cue('guitar-hit'), body, QUIET, TH));
    t += 33;
  }
  assert.ok(best > 0.8, 'strum ' + best);
});

test('one foot lifted scores Kick when the legs are in view', () => {
  const pose = standing();
  pose[25] = { x: 0.6, y: 0.74, z: 0, visibility: 0.99 };
  pose[27] = { x: 0.64, y: 0.82, z: 0, visibility: 0.99 };
  const body = settleThen(pose);
  assert.ok(body.legsVisible);
  assert.ok(cueStrength(cue('kick'), body, QUIET, TH) > 0.8);
});

test('upper body only: arm moves still work and Kick falls back to movement low in the picture', () => {
  const hide = (lm: Landmark[]) => lm.map((p, i) => (i >= 23 ? { ...p, visibility: 0.05 } : p));
  const tracker = new BodyTracker();
  let t = 1000;
  for (let i = 0; i < 30; i += 1) { tracker.update(hide(standing()), t, 4 / 3); t += 33; }
  const pose = hide(standing());
  pose[13] = { x: 0.62, y: 0.25, z: 0, visibility: 0.99 };
  pose[15] = { x: 0.61, y: 0.1, z: 0, visibility: 0.99 };
  let body: BodyState | null = null;
  for (let i = 0; i < 6; i += 1) { body = tracker.update(pose, t, 4 / 3); t += 33; }
  assert.ok(body && !body.legsVisible && !body.hipsVisible);
  assert.ok(cueStrength(cue('grab-high'), body!, QUIET, TH) > 0.95);
  assert.equal(cueStrength(cue('kick'), body!, QUIET, TH), 0);
  assert.ok(cueStrength(cue('kick'), body!, { ...QUIET, bottom: 0.2 }, TH) > 0.9);
});

test('no body tracking: moves are judged by movement in their part of the picture, as in v0.1', () => {
  const zones: ZoneEnergy = { left: 0.2, right: 0.01, top: 0.01, bottom: 0.01, center: 0.05, any: 0.06 };
  const body = bodyFromZones(zones, 0);
  assert.equal(body.source, 'zones');
  assert.ok(cueStrength(cue('step-left'), body, zones, TH) > 0.9);
  assert.equal(cueStrength(cue('step-right'), body, zones, TH), 0);
  assert.ok(body.lean < -0.1, 'avatar leans toward the movement');
});

test('a lost or half-empty frame is ignored instead of throwing', () => {
  const tracker = new BodyTracker();
  assert.equal(tracker.update([], 0), null);
  const hidden = standing().map(p => ({ ...p, visibility: 0.01 }));
  assert.equal(tracker.update(hidden, 33), null);
});

test('move runs never repeat a move back to back and are repeatable from a seed', () => {
  const run = buildCueOrder(200, 42);
  assert.equal(run.length, 200);
  for (let i = 1; i < run.length; i += 1) assert.notEqual(run[i].id, run[i - 1].id);
  assert.deepEqual(buildCueOrder(50, 42).map(c => c.id), run.slice(0, 50).map(c => c.id));
  assert.notDeepEqual(buildCueOrder(50, 7).map(c => c.id), run.slice(0, 50).map(c => c.id));
  assert.equal(new Set(run.slice(0, 12).map(c => c.id)).size, 12, 'every move appears once before any repeats');
});

test('scoring: on the beat is Perfect, late is lower, no move is a Miss', () => {
  assert.equal(scoreCue(1, 10, 0.1, 35).grade, 'perfect');
  const late = scoreCue(1, 180, 0.3, 35);
  assert.ok(late.grade === 'nice' || late.grade === 'close');
  assert.ok(late.score < scoreCue(1, 10, 0.3, 35).score);
  const miss = scoreCue(0.1, null, 0.4, 35);
  assert.equal(miss.grade, 'miss');
  assert.equal(miss.timingErrorMs, null);
  assert.ok(scoreCue(1, 200, 0.2, 100).score > scoreCue(1, 200, 0.2, 0).score, 'more forgiveness, higher score');
});
