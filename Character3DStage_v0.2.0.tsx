'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Delaunay } from 'd3-delaunay';
import * as THREE from 'three';
import type { FacePoint } from './faceScan_v0.2.0';
import type { CharacterAppearance } from './PipeDreamsCharacterCreator_v0.2.0';

export type CharacterCameraView = 'full' | 'face' | 'three-quarter' | 'side';
export interface Character3DStageProps {
  photo: string | null;
  facePoints: FacePoint[] | null;
  appearance: CharacterAppearance;
  view?: CharacterCameraView;
  motion?: { left: number; right: number; center: number; top: number; bottom: number };
  height?: number;
}

// Ordered MediaPipe face oval indices. Restricts Delaunay texture triangles to the face
// rather than stretching the user's background into a mesh.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
  365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58,
  132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

function inPolygon(px: number, py: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > py) !== (b[1] > py) &&
      px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function makeFacialMesh(points: FacePoint[], a: CharacterAppearance): THREE.BufferGeometry | null {
  if (points.length < 468) return null;
  const left = points[234], right = points[454], top = points[10], chin = points[152];
  if (!left || !right || !top || !chin) return null;
  const faceWidth = right[0] - left[0];
  if (faceWidth < 0.12) return null;
  const centerX = (left[0] + right[0]) / 2;
  const centerY = (top[1] + chin[1]) / 2;
  const scale = 1.8 / faceWidth;
  const faceHeight = Math.max(0.15, chin[1] - top[1]);
  const xy: Array<[number, number]> = points.slice(0, 468).map(p => [p[0], p[1]]);
  const edge = FACE_OVAL.map(i => xy[i]);
  const triangles = Delaunay.from(xy).triangles;
  const positions: number[] = [];
  const uv: number[] = [];

  const push = (index: number) => {
    const p = points[index];
    const dx = (p[0] - centerX) / (faceWidth / 2);
    const dy = (p[1] - centerY) / (faceHeight / 2);
    const lower = THREE.MathUtils.smoothstep(dy, -0.15, 0.88);
    const cheekFactor = Math.exp(-Math.pow((dy - 0.05) / 0.36, 2));
    const noseFactor = Math.exp(-Math.pow(dx / 0.34, 2) - Math.pow((dy - 0.08) / 0.40, 2));
    const eyeFactor = Math.exp(-Math.pow((dy + 0.20) / 0.22, 2));
    const jawWidth = (a.jawWidth ?? 100) / 100;
    const cheekWidth = (a.cheekWidth ?? 100) / 100;
    const noseWidth = (a.noseWidth ?? 100) / 100;
    const noseDepth = (a.noseDepth ?? 100) / 100;
    const eyeSpacing = (a.eyeSpacing ?? 100) / 100;
    const faceWidthMorph = (a.faceWidth ?? 100) / 100;
    const faceLengthMorph = (a.faceLength ?? 100) / 100;

    let x = (p[0] - centerX) * scale * faceWidthMorph;
    x *= 1 + (jawWidth - 1) * lower + (cheekWidth - 1) * cheekFactor;
    x *= 1 + (noseWidth - 1) * noseFactor + (eyeSpacing - 1) * eyeFactor;
    const y = 3.7 + (centerY - p[1]) * scale * faceLengthMorph;
    const z = 0.55 - p[2] * scale * 0.52 + (noseDepth - 1) * noseFactor * 0.48;
    positions.push(x, y, z);
    // Image top-left -> WebGL texture bottom-left.
    uv.push(p[0], 1 - p[1]);
  };

  for (let i = 0; i < triangles.length; i += 3) {
    const ia = triangles[i], ib = triangles[i + 1], ic = triangles[i + 2];
    const pa = xy[ia], pb = xy[ib], pc = xy[ic];
    const midX = (pa[0] + pb[0] + pc[0]) / 3;
    const midY = (pa[1] + pb[1] + pc[1]) / 3;
    if (!inPolygon(midX, midY, edge)) continue;
    const edgeSq = (u: [number, number], v: [number, number]) =>
      Math.pow(u[0] - v[0], 2) + Math.pow(u[1] - v[1], 2);
    if (Math.max(edgeSq(pa, pb), edgeSq(pb, pc), edgeSq(pc, pa)) > Math.pow(faceWidth * 0.21, 2)) {
      continue;
    }
    push(ia);
    push(ib);
    push(ic);
  }

  if (positions.length < 300) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

function Capsule({ center, scale, color, rotation = [0, 0, 0] }: {
  center: [number, number, number];
  scale: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}) {
  return <mesh position={center} scale={scale} rotation={rotation} castShadow>
    <sphereGeometry args={[1, 24, 18]} />
    <meshStandardMaterial color={color} roughness={0.9} />
  </mesh>;
}

function Avatar({
  photo, facePoints, appearance: a, motion,
}: Pick<Character3DStageProps, 'photo' | 'facePoints' | 'appearance' | 'motion'>) {
  const actor = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);

  const faceGeometry = useMemo(
    () => facePoints ? makeFacialMesh(facePoints, a) : null,
    [facePoints, a]
  );
  const photoTexture = useMemo(() => {
    if (!photo || !facePoints) return null;
    const texture = new THREE.TextureLoader().load(photo);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }, [photo, facePoints]);

  useEffect(() => () => {
    faceGeometry?.dispose();
    photoTexture?.dispose();
  }, [faceGeometry, photoTexture]);

  const bodyWidth = a.bodyWidth / 100;
  const height = a.bodyHeight / 100;
  const skin = a.skin;
  const cloth = a.outfitColor;
  const isWestern = a.outfit === 'western';
  const isStage = a.outfit === 'stage';
  const isStudio = a.outfit === 'studio';

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const side = (motion?.right ?? 0) - (motion?.left ?? 0);
    const energy = Math.min(1, (motion?.center ?? 0) * 3);
    const armSwing = Math.min(0.55, (motion?.top ?? 0) * 3);
    if (actor.current) {
      actor.current.rotation.y = THREE.MathUtils.damp(actor.current.rotation.y, side * 0.22, 5, dt);
      actor.current.rotation.z = THREE.MathUtils.damp(actor.current.rotation.z, side * 0.07, 5, dt);
      actor.current.position.y = 0.018 * Math.sin(t * 1.7) + energy * 0.025;
    }
    if (armL.current) armL.current.rotation.z = THREE.MathUtils.damp(armL.current.rotation.z, -armSwing, 4, dt);
    if (armR.current) armR.current.rotation.z = THREE.MathUtils.damp(armR.current.rotation.z, armSwing, 4, dt);
  });

  return <group ref={actor} position={[0, 0.05, 0]}>
    {/* Legs, boots, hands, and torso make the character a rotatable 3D body, not a portrait panel. */}
    <Capsule center={[-0.31 * bodyWidth, 0.80 * height, 0]} scale={[0.24, 0.88 * height, 0.25]} color={isStage ? '#10151e' : '#262c37'} />
    <Capsule center={[0.31 * bodyWidth, 0.80 * height, 0]} scale={[0.24, 0.88 * height, 0.25]} color={isStage ? '#10151e' : '#262c37'} />
    <Capsule center={[-0.31 * bodyWidth, 0.22, 0.21]} scale={[0.32, 0.20, 0.48]} color="#292321" />
    <Capsule center={[0.31 * bodyWidth, 0.22, 0.21]} scale={[0.32, 0.20, 0.48]} color="#292321" />
    <Capsule center={[0, 2.10, -0.04]} scale={[0.85 * bodyWidth, 0.92 * height, 0.43]} color={cloth} />
    <Capsule center={[0, 1.64, -0.02]} scale={[0.65 * bodyWidth, 0.42, 0.41]} color={cloth} />
    <Capsule center={[0, 2.99, 0.01]} scale={[0.22, 0.34, 0.22]} color={skin} />
    {isWestern && <group>
      <Capsule center={[-0.52 * bodyWidth, 2.78, 0.28]} scale={[0.24, 0.20, 0.12]} color="#e4c292" rotation={[0, 0, 0.24]} />
      <Capsule center={[0.52 * bodyWidth, 2.78, 0.28]} scale={[0.24, 0.20, 0.12]} color="#e4c292" rotation={[0, 0, -0.24]} />
    </group>}
    {isStage && <Capsule center={[0, 2.25, 0.40]} scale={[0.10, 0.75, 0.04]} color="#d6b85c" />}
    {isStudio && <Capsule center={[0, 2.6, 0.43]} scale={[0.62, 0.08, 0.05]} color="#20232b" />}

    <group ref={armL} position={[-0.83 * bodyWidth, 2.84, 0]}>
      <Capsule center={[-0.30, -0.48, 0]} scale={[0.26, 0.67, 0.24]} color={cloth} rotation={[0, 0, -0.28]} />
      <Capsule center={[-0.47, -1.06, 0.04]} scale={[0.16, 0.19, 0.17]} color={skin} />
    </group>
    <group ref={armR} position={[0.83 * bodyWidth, 2.84, 0]}>
      <Capsule center={[0.30, -0.48, 0]} scale={[0.26, 0.67, 0.24]} color={cloth} rotation={[0, 0, 0.28]} />
      <Capsule center={[0.47, -1.06, 0.04]} scale={[0.16, 0.19, 0.17]} color={skin} />
    </group>

    {/* The head and skull are actual 3D geometry; selfie landmarks determine the
        textured front surface when a scan exists. Back/head/hair remain estimates. */}
    <Capsule center={[0, 3.7, -0.12]}
      scale={[0.93 * a.faceWidth / 100, 1.16 * a.faceLength / 100, 0.77]}
      color={skin} />
    {faceGeometry && photoTexture &&
      <mesh geometry={faceGeometry} castShadow renderOrder={2}>
        <meshStandardMaterial map={photoTexture} side={THREE.DoubleSide} roughness={0.93}
          metalness={0} color="#ffffff" />
      </mesh>}

    {a.hair !== 'photo' && a.hair !== 'cap' &&
      <Capsule center={[0, 4.38, -0.14]}
        scale={[0.93 * a.faceWidth / 100, a.hair === 'long' ? 0.53 : 0.34, 0.79]}
        color={a.hairColor} />}
    {a.hair === 'long' &&
      <group>
        <Capsule center={[-0.84, 3.70, -0.20]} scale={[0.23, 0.94, 0.42]} color={a.hairColor} />
        <Capsule center={[0.84, 3.70, -0.20]} scale={[0.23, 0.94, 0.42]} color={a.hairColor} />
      </group>}
    {a.hair === 'cap' && <group>
      <Capsule center={[0, 4.44, 0]} scale={[1.05, 0.30, 0.86]} color={a.hairColor} />
      <Capsule center={[0, 4.30, 0.67]} scale={[0.88, 0.09, 0.45]} color={a.hairColor} />
    </group>}
    {a.beard !== 'none' && <group>
      {(a.beard === 'full' || a.beard === 'stubble') &&
        <Capsule center={[0, 2.88 * a.faceLength / 100 + .1, 0.28]}
          scale={[0.63 * a.faceWidth / 100, a.beard === 'full' ? 0.39 : 0.26, 0.47]}
          color={a.beardColor} />}
      {(a.beard === 'full' || a.beard === 'mustache') &&
        <Capsule center={[0, 3.39, 0.70]} scale={[0.40, 0.075, 0.085]} color={a.beardColor} />}
    </group>}
    {a.glasses !== 'none' && <group position={[0, 3.94, 0.77]}>
      {[-0.31, 0.31].map(x => <group key={x}>
        <mesh position={[x, 0, 0]}>
          <torusGeometry args={[0.31, 0.035, 8, 32]} />
          <meshStandardMaterial color="#151b25" metalness={0.45} roughness={0.3} />
        </mesh>
        <mesh position={[x, 0, -0.004]}>
          <circleGeometry args={[0.28, 32]} />
          <meshStandardMaterial transparent opacity={a.glasses === 'shades' ? 0.68 : 0.14}
            color={a.glasses === 'shades' ? '#111924' : '#a4c9de'} />
        </mesh>
      </group>)}
      <Capsule center={[0, 0, 0.01]} scale={[0.11, 0.035, 0.035]} color="#151b25" />
    </group>}
  </group>;
}

const VIEWS: Record<CharacterCameraView, {
  camera: [number, number, number];
  target: [number, number, number];
  near: number;
}> = {
  full: { camera: [0, 2.65, 8.2], target: [0, 2.35, 0], near: 2.6 },
  face: { camera: [0, 3.81, 3.3], target: [0, 3.7, 0], near: 1.4 },
  'three-quarter': { camera: [5.9, 3.5, 5.9], target: [0, 2.55, 0], near: 2.6 },
  side: { camera: [8, 3.2, 0.1], target: [0, 2.45, 0], near: 2.6 },
};

export default function Character3DStage({
  photo, facePoints, appearance, view = 'full', motion, height = 560,
}: Character3DStageProps) {
  const current = VIEWS[view];
  return <div style={{ height }} className="relative w-full overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#0a1320]">
    <Canvas key={view} camera={{ position: current.camera, fov: 34, near: 0.05, far: 100 }}
      shadows gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#101b28']} />
      <fog attach="fog" args={['#101b28', 10, 17]} />
      <ambientLight intensity={1.4} />
      <hemisphereLight args={['#c7e7ff', '#25202a', 1.4]} />
      <directionalLight position={[4, 7, 6]} intensity={2.1} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <directionalLight position={[-5, 5, -3]} intensity={1.1} />
      <Avatar photo={photo} facePoints={facePoints} appearance={appearance} motion={motion} />
      <mesh receiveShadow position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#122435" metalness={0.1} roughness={0.95} />
      </mesh>
      <gridHelper args={[12, 24, '#2c4c60', '#1a3145']} position={[0, 0, 0]} />
      <OrbitControls target={current.target} minDistance={current.near} maxDistance={11}
        minPolarAngle={0.2} maxPolarAngle={Math.PI - 0.22} enablePan={false} />
    </Canvas>
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs text-white/75">
      DRAG TO ROTATE · PINCH TO ZOOM · 3D MODEL
    </div>
    {!facePoints && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-amber-900/85 px-3 py-2 text-xs text-white">
      Generic head · Upload &amp; scan selfie for your face
    </div>}
  </div>;
}
