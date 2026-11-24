'use client';

import React, { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Performer, type PulseLive } from './PulseAvatar_v0.2.0';
import type { CharacterAppearance } from './PipeDreamsCharacterCreator_v0.2.0';
import type { FacePoint } from './headLayout_v0.2.1';
import { restBody } from './pulseTracking_v0.2.0';

/**
 * My Character preview v0.2.1. Same props as Character3DStage_v0.2.0 (which is kept unchanged), but it
 * shows the same jointed figure and head that performs on the PULSE stage, so what you build is what plays.
 */
export type CharacterCameraView = 'full' | 'face' | 'three-quarter' | 'side';
export interface Character3DStageProps {
  photo: string | null;
  facePoints: FacePoint[] | null;
  appearance: CharacterAppearance;
  view?: CharacterCameraView;
  height?: number;
}

const VIEWS: Record<CharacterCameraView, { camera: [number, number, number]; target: [number, number, number]; near: number }> = {
  full: { camera: [0, 2.9, 12.2], target: [0, 2.45, 0], near: 3 },
  face: { camera: [0, 4.4, 3.9], target: [0, 4.32, 0.15], near: 1.6 },
  'three-quarter': { camera: [2.6, 4.45, 3.1], target: [0, 4.3, 0.1], near: 1.6 },
  side: { camera: [4.2, 4.35, 0.25], target: [0, 4.3, 0.05], near: 1.6 },
};

export default function Character3DStage({ photo, facePoints, appearance, view = 'full', height = 560 }: Character3DStageProps) {
  const live = useRef<PulseLive>({ body: restBody(), playing: false, beatPhase: 1, flashAt: 0, flashGrade: null });
  const current = VIEWS[view];
  return <div style={{ height }} className="relative w-full overflow-hidden rounded-2xl border border-[color:var(--line,rgba(208,135,74,.32))] bg-[#0a0605]">
    <Canvas key={view} shadows dpr={[1, 2]} camera={{ position: current.camera, fov: 32, near: 0.05, far: 100 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#0d0907']} />
      <ambientLight intensity={0.7} color="#fff1dd" />
      <hemisphereLight args={['#ffe7c7', '#1a0f0a', 0.9]} />
      <directionalLight position={[3, 7, 8]} intensity={2.2} color="#fff4e6" castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={7} shadow-camera-bottom={-1} />
      <directionalLight position={[-5, 4, 3]} intensity={0.9} color="#ffd9b0" />
      <directionalLight position={[-4, 5, -6]} intensity={1.4} color="#ff8a4a" />
      <Performer photo={photo} facePoints={facePoints} appearance={appearance} live={live} />
      <mesh receiveShadow position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 64]} />
        <meshStandardMaterial color="#17100c" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.06, 10, 80]} />
        <meshStandardMaterial color="#d68c50" metalness={0.85} roughness={0.35} emissive="#ff8a3d" emissiveIntensity={0.12} />
      </mesh>
      <OrbitControls target={current.target} minDistance={current.near} maxDistance={14}
        minPolarAngle={0.2} maxPolarAngle={Math.PI - 0.22} enablePan={false} />
    </Canvas>
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/75">
      Drag to turn · pinch to zoom
    </div>
    {!(photo && facePoints) && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/65 px-3 py-1.5 text-xs text-white/85">
      Standard face. Add a selfie to use yours.
    </div>}
  </div>;
}
