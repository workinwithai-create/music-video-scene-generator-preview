'use client';

import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { CharacterAppearance } from './PipeDreamsCharacterCreator_v0.2.0';
import { layoutHead, type FacePoint, type HeadLayout, type Vec3 } from './headLayout_v0.2.1';

/**
 * My Character head v0.2.1, used both in the editor and on the PULSE stage so a character looks
 * the same in both places. The shape comes from headLayout_v0.2.1.ts: one skin for face and skull,
 * with the selfie laid over the face and faded into the skin at the edge.
 *
 * The group's origin is the top of the neck, so the parent can nod and turn the head from there.
 */
export interface CharacterHeadProps {
  photo: string | null;
  facePoints: FacePoint[] | null | undefined;
  appearance: CharacterAppearance;
  /** Size of the head relative to head space (face half-width 0.9). */
  scale?: number;
}

function Blob({ at, scale, color, roughness = 0.9, metalness = 0 }: {
  at: Vec3; scale: Vec3; color: string; roughness?: number; metalness?: number;
}) {
  return <mesh position={at} scale={scale} castShadow>
    <sphereGeometry args={[1, 20, 14]} />
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  </mesh>;
}

function buildGeometries(layout: HeadLayout) {
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
  skin.setIndex(layout.skinIndices);
  skin.computeVertexNormals();

  let face: THREE.BufferGeometry | null = null;
  if (layout.faceUv) {
    face = new THREE.BufferGeometry();
    // Same points and same shading as the skin underneath, so the photo sits exactly on it.
    face.setAttribute('position', new THREE.BufferAttribute(layout.positions.slice(0, 468 * 3), 3));
    face.setAttribute('normal', new THREE.BufferAttribute((skin.getAttribute('normal').array as Float32Array).slice(0, 468 * 3), 3));
    face.setAttribute('uv', new THREE.BufferAttribute(layout.faceUv, 2));
    const colors = new Float32Array(468 * 4);
    for (let i = 0; i < 468; i += 1) colors.set([1, 1, 1, layout.faceAlpha[i]], i * 4);
    face.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    face.setIndex(layout.faceIndices);
  }

  const hair = new THREE.BufferGeometry();
  hair.setAttribute('position', new THREE.BufferAttribute(layout.hairPositions, 3));
  hair.setIndex(layout.hairIndices);
  hair.computeVertexNormals();
  return { skin, face, hair };
}

export default function CharacterHead({ photo, facePoints, appearance: a, scale = 1 }: CharacterHeadProps) {
  const layout = useMemo(
    () => layoutHead(photo ? facePoints : null, a, a.hair),
    [photo, facePoints, a.hair, a.jawWidth, a.cheekWidth, a.noseWidth, a.noseDepth, a.eyeSpacing, a.faceWidth, a.faceLength],
  );
  const geometry = useMemo(() => buildGeometries(layout), [layout]);
  const texture = useMemo(() => {
    if (!photo || !layout.faceUv) return null;
    const loaded = new THREE.TextureLoader().load(photo);
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.wrapS = THREE.ClampToEdgeWrapping;
    loaded.wrapT = THREE.ClampToEdgeWrapping;
    loaded.anisotropy = 4;
    return loaded;
  }, [photo, layout.faceUv]);
  useEffect(() => () => { geometry.skin.dispose(); geometry.face?.dispose(); geometry.hair.dispose(); }, [geometry]);
  useEffect(() => () => { texture?.dispose(); }, [texture]);

  const { eyes, brows, halfWidth: w, earY, earZ, chin, top, crown } = layout;
  const eyeY = (eyes[0][1] + eyes[1][1]) / 2;
  const eyeFront = Math.max(eyes[0][2], eyes[1][2]);
  const height = top - chin;
  const side = w + 0.14;
  const bandRadius = crown - earY + 0.1;

  return <group scale={scale}>
    <group position={[-layout.neck[0], -layout.neck[1], -layout.neck[2]]}>
      <mesh geometry={geometry.skin} castShadow>
        <meshStandardMaterial color={a.skin} roughness={0.9} />
      </mesh>
      {geometry.face && texture && <mesh geometry={geometry.face} renderOrder={2}>
        <meshStandardMaterial map={texture} vertexColors transparent depthWrite={false} roughness={0.93} metalness={0}
          polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>}

      {!(geometry.face && texture) && <group>
        {/* No selfie: the neutral face still gets eyes and brows. */}
        {eyes.map((eye, i) => <Blob key={'eye' + i} at={[eye[0], eye[1], eye[2] + 0.015]} scale={[0.085, 0.062, 0.03]} color="#1c1210" roughness={0.35} />)}
        {brows.map((brow, i) => <Blob key={'brow' + i} at={[brow[0], brow[1] + 0.02, brow[2] + 0.02]} scale={[0.2, 0.035, 0.04]} color={a.hairColor} />)}
      </group>}

      <Blob at={[-w - 0.01, earY - 0.06, earZ - 0.2]} scale={[0.07, 0.21, 0.13]} color={a.skin} />
      <Blob at={[w + 0.01, earY - 0.06, earZ - 0.2]} scale={[0.07, 0.21, 0.13]} color={a.skin} />

      <mesh geometry={geometry.hair} castShadow>
        <meshStandardMaterial color={a.hairColor} roughness={0.96} side={THREE.DoubleSide} />
      </mesh>
      {a.hair === 'long' && <group>
        <Blob at={[-w - 0.07, earY - 0.6, earZ - 0.3]} scale={[0.2, 0.95, 0.44]} color={a.hairColor} roughness={0.96} />
        <Blob at={[w + 0.07, earY - 0.6, earZ - 0.3]} scale={[0.2, 0.95, 0.44]} color={a.hairColor} roughness={0.96} />
      </group>}
      {a.hair === 'cap' && <Blob at={[0, top - 0.03, layout.foreheadPoint[2] + 0.2]} scale={[0.7, 0.05, 0.36]} color={a.hairColor} />}

      {a.beard !== 'none' && <group>
        {(a.beard === 'full' || a.beard === 'stubble') &&
          <Blob at={[0, chin + height * 0.1, layout.chinPoint[2] - 0.34]}
            scale={[0.6 * (w / 0.9), a.beard === 'full' ? 0.42 : 0.3, 0.46]} color={a.beardColor} roughness={0.96} />}
        {(a.beard === 'full' || a.beard === 'mustache') &&
          <Blob at={[0, (layout.noseTip[1] + layout.mouth[1]) / 2 - 0.05, layout.mouth[2] + 0.07]} scale={[0.3, 0.06, 0.07]} color={a.beardColor} roughness={0.96} />}
      </group>}

      {a.glasses !== 'none' && <group position={[0, eyeY, eyeFront + 0.2]}>
        {eyes.map((eye, i) => <group key={i} position={[eye[0], 0, 0]}>
          <mesh>
            <torusGeometry args={[0.27, 0.03, 8, 28]} />
            <meshStandardMaterial color="#1b0f08" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Drawn after the photo and without hiding what is behind it, so the eyes show through clear lenses. */}
          <mesh position={[0, 0, -0.004]} renderOrder={3}>
            <circleGeometry args={[0.25, 28]} />
            <meshStandardMaterial transparent depthWrite={false} opacity={a.glasses === 'shades' ? 0.82 : 0.1}
              color={a.glasses === 'shades' ? '#140d09' : '#e8d3b0'} />
          </mesh>
          {/* Arm back to the ear. */}
          <mesh position={[Math.sign(eye[0]) * (w - Math.abs(eye[0]) + 0.02), 0.02, (earZ - eyeFront - 0.2) / 2]}>
            <boxGeometry args={[0.03, 0.03, Math.abs(earZ - eyeFront - 0.2)]} />
            <meshStandardMaterial color="#1b0f08" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>)}
        <Blob at={[0, 0.02, 0]} scale={[Math.max(0.04, Math.abs(eyes[1][0] - eyes[0][0]) / 2 - 0.27), 0.03, 0.03]} color="#1b0f08" metalness={0.6} roughness={0.3} />
      </group>}

      {a.outfit === 'studio' && <group>
        {/* Studio look: headphones. */}
        <mesh position={[0, earY, earZ - 0.15]} scale={[side / bandRadius, 1, 1]}>
          <torusGeometry args={[bandRadius, 0.06, 8, 32, Math.PI]} />
          <meshStandardMaterial color="#1b0f08" metalness={0.5} roughness={0.4} />
        </mesh>
        <Blob at={[-side, earY - 0.04, earZ - 0.15]} scale={[0.12, 0.3, 0.3]} color="#2a1a12" metalness={0.3} />
        <Blob at={[side, earY - 0.04, earZ - 0.15]} scale={[0.12, 0.3, 0.3]} color="#2a1a12" metalness={0.3} />
      </group>}
    </group>
  </group>;
}
