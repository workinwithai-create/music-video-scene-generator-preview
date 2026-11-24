// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACE_OVAL, FACE_TRIANGLES } from '../faceData_v0.2.1.ts';
import { layoutHead, SELFIE_ASPECT, type FacePoint } from '../headLayout_v0.2.1.ts';

const scan: FacePoint[] = JSON.parse(readFileSync(new URL('./fixtures/face-scan.json', import.meta.url), 'utf8')).facePoints;

/** The same face as if the selfie had been taken with the head turned, tipped and tilted. */
function turned(points: FacePoint[], yawDeg: number, pitchDeg: number, rollDeg: number): FacePoint[] {
  const A = SELFIE_ASPECT, rad = Math.PI / 180;
  const iso = points.map(p => [p[0] * A, p[1], p[2] * A]);
  const c = [0, 1, 2].map(k => iso.reduce((sum, p) => sum + p[k], 0) / iso.length);
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yawDeg * rad), Math.sin(yawDeg * rad), Math.cos(pitchDeg * rad), Math.sin(pitchDeg * rad), Math.cos(rollDeg * rad), Math.sin(rollDeg * rad)];
  return iso.map(p => {
    let [x, y, z] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    [x, y] = [x * cr - y * sr, x * sr + y * cr];
    return [(x + c[0]) / A, y + c[1], (z + c[2]) / A] as FacePoint;
  });
}

const facePos = (layout: ReturnType<typeof layoutHead>, i: number) => [layout.positions[i * 3], layout.positions[i * 3 + 1], layout.positions[i * 3 + 2]];

test('a scanned face comes out in true proportion, facing straight ahead', () => {
  const head = layoutHead(scan);
  assert.equal(head.scanned, true);
  const ratio = (head.top - head.chin) / (2 * head.halfWidth);
  assert.ok(ratio > 1.15 && ratio < 1.5, 'face height / width was ' + ratio.toFixed(2) + ' (v0.2.0 gave about 1.04)');
  const [lx, ly, lz] = facePos(head, 234), [rx, ry, rz] = facePos(head, 454);
  assert.ok(Math.abs(lx + rx) < 0.02 && Math.abs(ly - ry) < 0.02 && Math.abs(lz - rz) < 0.02, 'cheek edges are level and equally deep');
  const nose = head.noseTip;
  assert.ok(Math.abs(nose[0]) < 0.15, 'nose is on the centre line');
  let front = -Infinity;
  for (let i = 0; i < 468; i += 1) front = Math.max(front, head.positions[i * 3 + 2]);
  assert.ok(front - nose[2] < 0.08, 'nose tip is the frontmost part of the face');
});

test('a selfie from below with the head turned gives the same face as a straight-on one', () => {
  const straight = layoutHead(scan);
  const awkward = layoutHead(turned(scan, 35, -20, 15));
  let worst = 0;
  for (let i = 0; i < 468 * 3; i += 1) worst = Math.max(worst, Math.abs(straight.positions[i] - awkward.positions[i]));
  assert.ok(worst < 0.02, 'largest difference ' + worst.toFixed(4));
});

test('the face is one complete skin: every standard triangle is present, however the head was turned', () => {
  for (const points of [scan, turned(scan, 35, -20, 15), turned(scan, -40, 15, -10)]) {
    const head = layoutHead(points);
    assert.equal(head.faceIndices.length, FACE_TRIANGLES.length);
    assert.equal(head.faceIndices.length / 3, 898);
    assert.ok(head.positions.every(Number.isFinite));
  }
});

test('nothing sits in front of the face: the back of the head only ever goes backward from the face edge', () => {
  for (const points of [scan, turned(scan, 35, -20, 15), null]) {
    const head = layoutHead(points);
    const count = head.positions.length / 3;
    const ring = FACE_OVAL.length;
    for (let i = 468; i < count - 1; i += 1) {
      const origin = FACE_OVAL[(i - 468) % ring];
      assert.ok(head.positions[i * 3 + 2] <= head.positions[origin * 3 + 2] + 1e-6, 'skull vertex ' + i + ' is in front of the face edge');
    }
    assert.ok(head.backZ < head.earZ - 0.8, 'the head has a back');
    const depth = Math.max(...Array.from({ length: 468 }, (_, i) => head.positions[i * 3 + 2])) - head.backZ;
    const lengthToWidth = depth / (2 * head.halfWidth);
    assert.ok(lengthToWidth > 1.1 && lengthToWidth < 1.55, 'head length / width ' + lengthToWidth.toFixed(2));
    assert.ok(head.crown > head.top + 0.2, 'there is a crown above the forehead');
    const max = Math.max(...head.skinIndices);
    assert.ok(max < count && head.skinIndices.length % 3 === 0);
  }
});

test('the photo fades out at the edge of the face and is full strength inside', () => {
  const head = layoutHead(scan);
  for (const i of FACE_OVAL) assert.equal(head.faceAlpha[i], 0);
  assert.equal(head.faceAlpha[1], 1);
  assert.equal(head.faceAlpha[13], 1);
  assert.ok(head.faceUv && head.faceUv.length === 468 * 2);
  assert.ok(Math.abs(head.faceUv![2] - scan[1][0]) < 1e-6 && Math.abs(head.faceUv![3] - (1 - scan[1][1])) < 1e-6);
});

test('no selfie, or a scan too broken to measure, gets the neutral face instead of a blank ball', () => {
  for (const points of [null, undefined, [], Array.from({ length: 468 }, () => [0, 0, 0] as FacePoint), Array.from({ length: 468 }, () => [NaN, 0, 0] as FacePoint)]) {
    const head = layoutHead(points as FacePoint[] | null);
    assert.equal(head.scanned, false);
    assert.equal(head.faceUv, null);
    assert.ok(head.positions.every(Number.isFinite));
    assert.ok(Math.abs(head.halfWidth - 0.9) < 0.01);
    const ratio = (head.top - head.chin) / (2 * head.halfWidth);
    assert.ok(ratio > 1.05 && ratio < 1.4, 'neutral ratio ' + ratio.toFixed(2));
  }
});

test('the face sliders still work', () => {
  const base = layoutHead(scan);
  assert.ok(layoutHead(scan, { faceWidth: 120 }).halfWidth > base.halfWidth * 1.15);
  const longer = layoutHead(scan, { faceLength: 115 });
  assert.ok(longer.top - longer.chin > (base.top - base.chin) * 1.1);
  assert.ok(layoutHead(scan, { noseDepth: 130 }).noseTip[2] > base.noseTip[2] + 0.1);
  const jaw = layoutHead(scan, { jawWidth: 125 });
  assert.ok(Math.abs(facePos(jaw, 172)[0]) > Math.abs(facePos(base, 172)[0]) * 1.1);
});

test('hair covers the top and back of the head and leaves the face clear', () => {
  for (const style of ['photo', 'short', 'slick', 'long', 'cap'] as const) {
    const head = layoutHead(scan, {}, style);
    assert.ok(head.hairIndices.length > 300, style + ' has hair');
    assert.ok(Math.max(...head.hairIndices) < head.hairPositions.length / 3);
    const used = new Set(head.hairIndices);
    for (const i of used) {
      if (i < 468) assert.ok(head.positions[i * 3 + 1] > head.eyes[0][1] + 0.3, style + ': hair on the face at landmark ' + i);
      assert.ok(head.hairPositions[i * 3 + 1] > head.chin, style + ': hair below the chin');
    }
  }
  const short = layoutHead(scan, {}, 'short'), long = layoutHead(scan, {}, 'long');
  assert.ok(long.hairIndices.length > short.hairIndices.length);
});
