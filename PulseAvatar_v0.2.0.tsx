'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { makeFacialMesh } from './Character3DStage_v0.2.0';
import type { CharacterAppearance, PipeDreamsCharacter } from './PipeDreamsCharacterCreator_v0.2.0';
import type { BodyState, Grade, Vec3 } from './pulseTracking_v0.2.0';

/**
 * PULSE v0.2.0 performer: a jointed 3D figure (shoulders, elbows, hips, knees, head) that copies
 * the player's body like a mirror, standing on a Pipe Dreams stage. It wears the saved My Character
 * look, including the scanned selfie face when there is one.
 *
 * The room writes the latest body state into `live.current` every camera frame; this component
 * reads it inside the render loop, so React never re-renders at camera speed.
 */
export interface PulseLive {
  body: BodyState;
  playing: boolean;
  /** 0..1 through the current beat (0 = right on the beat). */
  beatPhase: number;
  /** performance.now() when the last move was judged, for the stage flash. */
  flashAt: number;
  flashGrade: Grade | null;
}

/** Used until the player builds their own character, so the stage is never empty. */
export const STAND_IN_APPEARANCE: CharacterAppearance = {
  faceWidth: 100, faceLength: 100, jawWidth: 100, cheekWidth: 100, noseWidth: 100, noseDepth: 100, eyeSpacing: 100,
  bodyWidth: 100, bodyHeight: 100,
  skin: '#c68c68', hair: 'short', hairColor: '#2c1d16', beard: 'none', beardColor: '#2c1d16',
  glasses: 'none', outfit: 'stage', outfitColor: '#71402e',
};

const THIGH = 0.98, SHIN = 0.98, FOOT = 0.16, UPPER_ARM = 0.74, FOREARM = 0.7;
const SHOULDER_Y = 1.42, SHOULDER_X = 0.66, HEAD_Y = 2.27, HEAD_SCALE = 0.46;
const DOWN = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function Limb({ length, radius, color, roughness = 0.82 }: { length: number; radius: number; color: string; roughness?: number }) {
  return <mesh position={[0, -length / 2, 0]} castShadow>
    <capsuleGeometry args={[radius, length, 6, 14]} />
    <meshStandardMaterial color={color} roughness={roughness} />
  </mesh>;
}

function Blob({ at, scale, color, roughness = 0.85, metalness = 0 }: {
  at: [number, number, number]; scale: [number, number, number]; color: string; roughness?: number; metalness?: number;
}) {
  return <mesh position={at} scale={scale} castShadow>
    <sphereGeometry args={[1, 24, 18]} />
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  </mesh>;
}

/** The head from Character Studio 3D v0.2.0 (same measurements), so a saved character looks the same here. */
function Head({ character, appearance: a }: { character: PipeDreamsCharacter | null; appearance: CharacterAppearance }) {
  const facePoints = character?.facePoints || null;
  const photo = character?.photoDataUrl || null;
  const faceGeometry = useMemo(() => (facePoints ? makeFacialMesh(facePoints, a) : null), [facePoints, a]);
  const photoTexture = useMemo(() => {
    if (!photo || !facePoints) return null;
    const texture = new THREE.TextureLoader().load(photo);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }, [photo, facePoints]);
  useEffect(() => () => { faceGeometry?.dispose(); photoTexture?.dispose(); }, [faceGeometry, photoTexture]);
  const fw = a.faceWidth / 100, fl = a.faceLength / 100;

  return <group scale={HEAD_SCALE}>
    <group position={[0, -3.7, 0]}>
      <Blob at={[0, 3.7, -0.12]} scale={[0.93 * fw, 1.16 * fl, 0.77]} color={a.skin} />
      {faceGeometry && photoTexture && <mesh geometry={faceGeometry} renderOrder={2}>
        <meshStandardMaterial map={photoTexture} side={THREE.DoubleSide} roughness={0.93} metalness={0} color="#ffffff" />
      </mesh>}
      {!faceGeometry && <group>
        {/* Simple eyes and brow so a character without a selfie still has a face. */}
        <Blob at={[-0.32 * fw, 3.86, 0.6]} scale={[0.085, 0.1, 0.05]} color="#1c1210" roughness={0.4} />
        <Blob at={[0.32 * fw, 3.86, 0.6]} scale={[0.085, 0.1, 0.05]} color="#1c1210" roughness={0.4} />
        <Blob at={[0, 3.6, 0.68]} scale={[0.11, 0.2, 0.12]} color={a.skin} />
      </group>}
      {a.hair !== 'photo' && a.hair !== 'cap' &&
        <Blob at={[0, 4.38, -0.14]} scale={[0.95 * fw, a.hair === 'long' ? 0.53 : 0.36, 0.8]} color={a.hairColor} roughness={0.95} />}
      {a.hair === 'long' && <group>
        <Blob at={[-0.84, 3.7, -0.2]} scale={[0.23, 0.94, 0.42]} color={a.hairColor} roughness={0.95} />
        <Blob at={[0.84, 3.7, -0.2]} scale={[0.23, 0.94, 0.42]} color={a.hairColor} roughness={0.95} />
      </group>}
      {a.hair === 'cap' && <group>
        <Blob at={[0, 4.44, 0]} scale={[1.05, 0.3, 0.86]} color={a.hairColor} />
        <Blob at={[0, 4.3, 0.67]} scale={[0.88, 0.09, 0.45]} color={a.hairColor} />
      </group>}
      {a.beard !== 'none' && <group>
        {(a.beard === 'full' || a.beard === 'stubble') &&
          <Blob at={[0, 2.88 * fl + 0.1, 0.28]} scale={[0.63 * fw, a.beard === 'full' ? 0.39 : 0.26, 0.47]} color={a.beardColor} roughness={0.95} />}
        {(a.beard === 'full' || a.beard === 'mustache') &&
          <Blob at={[0, 3.39, 0.7]} scale={[0.4, 0.075, 0.085]} color={a.beardColor} roughness={0.95} />}
      </group>}
      {a.glasses !== 'none' && <group position={[0, 3.94, 0.77]}>
        {[-0.31, 0.31].map(x => <group key={x}>
          <mesh position={[x, 0, 0]}>
            <torusGeometry args={[0.31, 0.035, 8, 32]} />
            <meshStandardMaterial color="#1b0f08" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[x, 0, -0.004]}>
            <circleGeometry args={[0.28, 32]} />
            <meshStandardMaterial transparent opacity={a.glasses === 'shades' ? 0.72 : 0.14}
              color={a.glasses === 'shades' ? '#140d09' : '#e8d3b0'} />
          </mesh>
        </group>)}
        <Blob at={[0, 0, 0.01]} scale={[0.11, 0.035, 0.035]} color="#1b0f08" />
      </group>}
      {a.outfit === 'studio' && <group>
        {/* Studio look: headphones. */}
        <mesh position={[0, 3.95, -0.12]} rotation={[0, 0, 0]}>
          <torusGeometry args={[1.0, 0.07, 8, 32, Math.PI]} />
          <meshStandardMaterial color="#1b0f08" metalness={0.5} roughness={0.4} />
        </mesh>
        <Blob at={[-0.98 * fw, 3.8, -0.12]} scale={[0.14, 0.3, 0.3]} color="#2a1a12" metalness={0.3} />
        <Blob at={[0.98 * fw, 3.8, -0.12]} scale={[0.14, 0.3, 0.3]} color="#2a1a12" metalness={0.3} />
      </group>}
    </group>
  </group>;
}

function Performer({ character, live }: { character: PipeDreamsCharacter | null; live: React.RefObject<PulseLive> }) {
  const a = useMemo(
    () => (character?.appearance ? { ...STAND_IN_APPEARANCE, ...character.appearance } : STAND_IN_APPEARANCE),
    [character],
  );
  const bw = clampNumber(a.bodyWidth / 100, 0.75, 1.35);
  const size = clampNumber(a.bodyHeight / 100, 0.8, 1.2);
  const longSleeves = a.outfit === 'western' || a.outfit === 'stage';
  const trousers = a.outfit === 'stage' ? '#15100d' : '#262c37';

  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armUL = useRef<THREE.Group>(null), armLL = useRef<THREE.Group>(null);
  const armUR = useRef<THREE.Group>(null), armLR = useRef<THREE.Group>(null);
  const legUL = useRef<THREE.Group>(null), legLL = useRef<THREE.Group>(null), footL = useRef<THREE.Group>(null);
  const legUR = useRef<THREE.Group>(null), legLR = useRef<THREE.Group>(null), footR = useRef<THREE.Group>(null);

  // Scratch objects reused every frame.
  const tmp = useMemo(() => ({
    v: new THREE.Vector3(), rootQ: new THREE.Quaternion(), spineQ: new THREE.Quaternion(), parentInv: new THREE.Quaternion(),
    upperQ: new THREE.Quaternion(), lowerQ: new THREE.Quaternion(), q: new THREE.Quaternion(),
    smooth: { x: 0, lean: 0, twist: 0, hipY: THIGH + SHIN + FOOT, headRoll: 0, headYaw: 0 },
  }), []);

  useFrame(({ clock }, rawDt) => {
    const frame = live.current;
    if (!frame || !root.current || !hips.current || !spine.current) return;
    const dt = Math.min(rawDt, 0.1);
    const t = clock.getElapsedTime();
    const body = frame.body;
    const tracked = body.source !== 'none';
    const ease = 1 - Math.exp(-dt * (body.source === 'pose' ? 18 : 9));
    const s = tmp.smooth;
    const beatDip = frame.playing ? Math.pow(1 - frame.beatPhase, 3) : 0;
    // With no camera the performer idles: breathes, and nods along once the click is running.
    const idleSway = tracked ? 0 : Math.sin(t * 0.9) * 0.02;

    s.x += (clampNumber(body.shiftX, -1.4, 1.4) * 0.95 - s.x) * ease;
    s.lean += (body.lean + idleSway - s.lean) * ease;
    // The camera's sense of depth is rough, so the body only turns part of the way the tracker reports.
    s.twist += (clampNumber(body.twist * 0.55, -0.45, 0.45) - s.twist) * ease * 0.6;
    s.headRoll += (body.headRoll - s.headRoll) * ease;
    s.headYaw += (body.headYaw - s.headYaw) * ease;

    tmp.rootQ.setFromAxisAngle(UP_AXIS, s.twist);
    tmp.spineQ.setFromAxisAngle(Z_AXIS, -s.lean);
    root.current.quaternion.copy(tmp.rootQ);
    spine.current.quaternion.copy(tmp.spineQ);
    spine.current.position.y = -beatDip * 0.05 + Math.sin(t * 1.6) * 0.008;

    const aim = (out: THREE.Quaternion, dir: Vec3) => out.setFromUnitVectors(DOWN, tmp.v.set(dir[0], dir[1], dir[2]).normalize());

    // Arms hang off the leaning, turning torso, so undo the torso's own rotation before aiming them.
    const setArm = (upper: THREE.Group | null, lower: THREE.Group | null, up: Vec3, low: Vec3) => {
      if (!upper || !lower) return;
      tmp.parentInv.copy(tmp.rootQ).multiply(tmp.spineQ).invert();
      aim(tmp.upperQ, up);
      aim(tmp.lowerQ, low);
      upper.quaternion.slerp(tmp.q.copy(tmp.parentInv).multiply(tmp.upperQ), ease);
      lower.quaternion.slerp(tmp.q.copy(tmp.upperQ).invert().multiply(tmp.lowerQ), ease);
    };
    const idleArm = tracked ? 0 : Math.sin(t * 0.9) * 0.03 + beatDip * 0.05;
    setArm(armUL.current, armLL.current, [body.armL.upper[0] - idleArm, body.armL.upper[1], body.armL.upper[2]], body.armL.lower);
    setArm(armUR.current, armLR.current, [body.armR.upper[0] + idleArm, body.armR.upper[1], body.armR.upper[2]], body.armR.lower);

    // Legs: copy the player's when the camera can see them, otherwise bend the knees for ducks and the beat.
    const bend = body.crouch * 0.95 + beatDip * 0.07;
    const fake = (sign: number): [Vec3, Vec3] => [
      [sign * 0.07, -Math.cos(bend), Math.sin(bend)],
      [0, -Math.cos(bend), -Math.sin(bend)],
    ];
    const legs: Array<[THREE.Group | null, THREE.Group | null, THREE.Group | null, Vec3, Vec3]> = [
      [legUL.current, legLL.current, footL.current, ...(body.legL.visible ? [body.legL.upper, body.legL.lower] as [Vec3, Vec3] : fake(-1))],
      [legUR.current, legLR.current, footR.current, ...(body.legR.visible ? [body.legR.upper, body.legR.lower] as [Vec3, Vec3] : fake(1))],
    ];
    let reach = 0;
    for (const [upper, lower, foot, up, low] of legs) {
      if (!upper || !lower || !foot) continue;
      tmp.parentInv.copy(tmp.rootQ).invert();
      aim(tmp.upperQ, up);
      aim(tmp.lowerQ, low);
      upper.quaternion.slerp(tmp.q.copy(tmp.parentInv).multiply(tmp.upperQ), ease);
      lower.quaternion.slerp(tmp.q.copy(tmp.upperQ).invert().multiply(tmp.lowerQ), ease);
      // Keep the boot flat on the floor whatever the shin is doing.
      foot.quaternion.copy(tmp.q.copy(tmp.lowerQ).invert().multiply(tmp.rootQ));
      const upLen = Math.hypot(up[0], up[1], up[2]) || 1, lowLen = Math.hypot(low[0], low[1], low[2]) || 1;
      reach = Math.max(reach, -(up[1] / upLen) * THIGH - (low[1] / lowLen) * SHIN);
    }
    // Hips sit wherever keeps the lower foot on the floor: a wide stance or bent knees drop the body.
    s.hipY += (Math.max(reach, 0.7) + FOOT - s.hipY) * ease;
    hips.current.position.set(0, s.hipY, 0);
    root.current.position.x = s.x;

    if (head.current) {
      head.current.rotation.z = -(s.headRoll - s.lean) * 0.9;
      head.current.rotation.y = s.headYaw * 0.8 - s.twist * 0.5;
      head.current.rotation.x = frame.playing && !tracked ? beatDip * 0.08 : 0;
    }
  });

  return <group scale={size}>
    <group ref={root}>
      <group ref={hips} position={[0, THIGH + SHIN + FOOT, 0]}>
        <Blob at={[0, 0.02, 0]} scale={[0.5 * bw, 0.32, 0.36]} color={trousers} />
        {[[-1, legUL, legLL, footL], [1, legUR, legLR, footR]].map(([sign, upper, lower, foot]) => (
          <group key={sign as number} ref={upper as React.RefObject<THREE.Group>} position={[(sign as number) * 0.27 * bw, -0.05, 0]}>
            <Limb length={THIGH} radius={0.21} color={trousers} />
            <group ref={lower as React.RefObject<THREE.Group>} position={[0, -THIGH, 0]}>
              <Limb length={SHIN} radius={0.17} color={trousers} />
              <group ref={foot as React.RefObject<THREE.Group>} position={[0, -SHIN, 0]}>
                <Blob at={[0, -0.02, 0.13]} scale={[0.2, 0.15, 0.36]} color="#3a2418" roughness={0.6} />
              </group>
            </group>
          </group>
        ))}

        <group ref={spine}>
          <mesh position={[0, 0.5, 0]} scale={[1.0 * bw, 1, 0.72]} castShadow>
            <capsuleGeometry args={[0.41, 0.42, 6, 18]} />
            <meshStandardMaterial color={a.outfitColor} roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.02, 0]} scale={[1.2 * bw, 1, 0.74]} castShadow>
            <capsuleGeometry args={[0.47, 0.34, 6, 18]} />
            <meshStandardMaterial color={a.outfitColor} roughness={0.85} />
          </mesh>
          <Blob at={[0, 0.14, 0.3]} scale={[0.09, 0.07, 0.04]} color="#f0c27a" roughness={0.3} metalness={0.9} />
          {a.outfit === 'stage' && [-0.16, 0.16].map(x => (
            <mesh key={x} position={[x * bw, 0.95, 0.36]} rotation={[0.08, 0, x > 0 ? 0.12 : -0.12]}>
              <boxGeometry args={[0.07, 0.86, 0.03]} />
              <meshStandardMaterial color="#f0c27a" metalness={0.85} roughness={0.3} />
            </mesh>
          ))}
          {a.outfit === 'western' && <mesh position={[0, 1.42, 0.3]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.24, 0.34, 4]} />
            <meshStandardMaterial color="#e4c292" roughness={0.9} />
          </mesh>}
          <mesh position={[0, 1.62, 0]}>
            <cylinderGeometry args={[0.13, 0.15, 0.34, 14]} />
            <meshStandardMaterial color={a.skin} roughness={0.85} />
          </mesh>

          {[[-1, armUL, armLL], [1, armUR, armLR]].map(([sign, upper, lower]) => (
            <group key={sign as number} position={[(sign as number) * SHOULDER_X * bw, SHOULDER_Y, 0]}>
              <Blob at={[0, 0, 0]} scale={[0.21, 0.21, 0.21]} color={a.outfitColor} />
              <group ref={upper as React.RefObject<THREE.Group>}>
                <Limb length={UPPER_ARM} radius={0.155} color={a.outfitColor} />
                <group ref={lower as React.RefObject<THREE.Group>} position={[0, -UPPER_ARM, 0]}>
                  <Limb length={FOREARM} radius={0.125} color={longSleeves ? a.outfitColor : a.skin} />
                  <Blob at={[0, -FOREARM - 0.1, 0]} scale={[0.13, 0.16, 0.11]} color={a.skin} />
                </group>
              </group>
            </group>
          ))}

          <group ref={head} position={[0, HEAD_Y, 0]}>
            <Head character={character} appearance={a} />
          </group>
        </group>
      </group>
    </group>
  </group>;
}

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Copper pipe ring set into the stage floor; it glows on every beat and flashes when a move lands. */
function StageFloor({ live }: { live: React.RefObject<PulseLive> }) {
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const glow = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const frame = live.current;
    if (!frame) return;
    const beat = frame.playing ? Math.pow(1 - frame.beatPhase, 4) : 0;
    const since = (performance.now() - frame.flashAt) / 1000;
    const flash = frame.flashGrade && since < 0.6 && frame.flashGrade !== 'miss'
      ? (1 - since / 0.6) * (frame.flashGrade === 'perfect' ? 2.4 : frame.flashGrade === 'nice' ? 1.3 : 0.5)
      : 0;
    if (ring.current) ring.current.emissiveIntensity = 0.16 + beat * 0.85 + flash;
    if (glow.current) glow.current.intensity = 3 + beat * 8 + flash * 9;
  });
  return <group>
    <mesh receiveShadow position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[9, 64]} />
      <meshStandardMaterial color="#120b08" roughness={0.92} metalness={0.05} />
    </mesh>
    <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[2.75, 0.085, 12, 96]} />
      <meshStandardMaterial ref={ring} color="#d68c50" metalness={0.85} roughness={0.32} emissive="#ff8a3d" emissiveIntensity={0.16} />
    </mesh>
    {/* Pipe couplings, like the logo. */}
    {[0, 1, 2, 3].map(i => (
      <mesh key={i} position={[Math.sin(i * Math.PI / 2 + Math.PI / 4) * 2.75, 0.05, Math.cos(i * Math.PI / 2 + Math.PI / 4) * 2.75]}
        rotation={[0, i * Math.PI / 2 + Math.PI / 4, 0]}>
        <boxGeometry args={[0.5, 0.24, 0.24]} />
        <meshStandardMaterial color="#b9743f" metalness={0.85} roughness={0.38} />
      </mesh>
    ))}
    <pointLight ref={glow} position={[0, 0.5, 1.2]} color="#ff8a3d" intensity={3} distance={7} decay={2} />
  </group>;
}

/** Pulls the camera back on narrow screens so outstretched arms always fit. */
function CameraRig() {
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const distance = Math.max(11.4, 9.8 / Math.max(aspect, 0.3));
    camera.position.set(0, 3.0, distance);
    camera.lookAt(0, 2.35, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function PulseAvatarStage({ character, live }: { character: PipeDreamsCharacter | null; live: React.RefObject<PulseLive> }) {
  return <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 32, near: 0.1, far: 80, position: [0, 3.0, 11.4] }}
    gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    style={{ width: '100%', height: '100%', touchAction: 'pan-y', pointerEvents: 'none' }}>
    <color attach="background" args={['#0a0605']} />
    <fog attach="fog" args={['#0a0605', 14, 30]} />
    <ambientLight intensity={0.55} color="#ffe7c7" />
    <hemisphereLight args={['#ffe7c7', '#1a0f0a', 0.9]} />
    <directionalLight position={[3, 8, 7]} intensity={2.5} color="#fff0dc" castShadow
      shadow-mapSize-width={1024} shadow-mapSize-height={1024}
      shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={7} shadow-camera-bottom={-1} />
    <directionalLight position={[-5, 5, -6]} intensity={2.4} color="#ff8a4a" />
    <directionalLight position={[5, 3, -5]} intensity={1.1} color="#f0c27a" />
    <CameraRig />
    <StageFloor live={live} />
    <Performer character={character} live={live} />
    <Sparkles count={36} color="#f0a45c" size={2.4} speed={0.25} opacity={0.55} scale={[8, 5, 4]} position={[0, 2.6, -1.2]} />
  </Canvas>;
}
