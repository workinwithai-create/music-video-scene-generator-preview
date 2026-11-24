'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Character3DStage, { type CharacterCameraView } from './Character3DStage_v0.2.1';
import { sampleFaceColors } from './faceColors_v0.2.1';
import { scanSelfie, type FacePoint } from './faceScan_v0.2.0';

export const CHARACTER_CREATOR_VERSION = '0.2.0';
export const CHARACTER_VAULT_KEY = 'pipe-dreams.character-vault.v1';

type Hair = 'photo' | 'short' | 'long' | 'slick' | 'cap';
type Beard = 'none' | 'stubble' | 'mustache' | 'full';
type Outfit = 'western' | 'stage' | 'studio' | 'street';
type Glasses = 'none' | 'clear' | 'shades';

export interface CharacterAppearance {
  jawWidth: number;
  cheekWidth: number;
  noseWidth: number;
  noseDepth: number;
  eyeSpacing: number;
  faceWidth: number;
  faceLength: number;
  bodyWidth: number;
  bodyHeight: number;
  skin: string;
  hair: Hair;
  hairColor: string;
  beard: Beard;
  beardColor: string;
  glasses: Glasses;
  outfit: Outfit;
  outfitColor: string;
}

export interface PipeDreamsCharacter {
  id: string;
  version: string;
  displayName: string;
  photoDataUrl: string | null;
  facePoints?: FacePoint[] | null;
  appearance: CharacterAppearance;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterCreatorProps {
  onSave?: (character: PipeDreamsCharacter) => void;
  onClose?: () => void;
}

const DEFAULT_APPEARANCE: CharacterAppearance = {
  faceWidth: 100,
  faceLength: 100,
  jawWidth: 100,
  cheekWidth: 100,
  noseWidth: 100,
  noseDepth: 100,
  eyeSpacing: 100,
  bodyWidth: 100,
  bodyHeight: 100,
  skin: '#c68c68',
  hair: 'photo',
  hairColor: '#34251e',
  beard: 'none',
  beardColor: '#34251e',
  glasses: 'none',
  outfit: 'western',
  outfitColor: '#274a67',
};

const COLOR_SWATCHES = ['#274a67', '#71402e', '#272b32', '#65563b', '#7c2e46', '#2a6655'];
const HAIR_OPTIONS: Hair[] = ['photo', 'short', 'long', 'slick', 'cap'];
const BEARD_OPTIONS: Beard[] = ['none', 'stubble', 'mustache', 'full'];
const OUTFIT_OPTIONS: Outfit[] = ['western', 'stage', 'studio', 'street'];
const GLASSES_OPTIONS: Glasses[] = ['none', 'clear', 'shades'];

function readVault(): PipeDreamsCharacter[] {
  try {
    const raw = localStorage.getItem(CHARACTER_VAULT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PipeDreamsCharacter =>
      !!item && typeof item === 'object' && typeof item.id === 'string' &&
      typeof item.displayName === 'string' && !!item.appearance
    );
  } catch {
    return [];
  }
}

function resizeSelfie(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose a photo file.'));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      reject(new Error('That photo is too large. Choose one under 25 MB.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // Portrait crop: a consistent, compact reference that works on mobile.
        const w = 480;
        const h = 600;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('This browser cannot process the photo.');
        const sourceRatio = img.width / img.height;
        const targetRatio = w / h;
        const sx = sourceRatio > targetRatio ? (img.width - img.height * targetRatio) / 2 : 0;
        const sy = sourceRatio < targetRatio ? (img.height - img.width / targetRatio) / 2 : 0;
        const sw = sourceRatio > targetRatio ? img.height * targetRatio : img.width;
        const sh = sourceRatio < targetRatio ? img.width / targetRatio : img.height;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The photo could not be opened.'));
    };
    img.src = url;
  });
}

function AvatarPreview({ photo, appearance, displayName }: {
  photo: string | null;
  appearance: CharacterAppearance;
  displayName: string;
}) {
  const rawId = useId().replace(/:/g, '');
  const faceId = 'face-' + rawId;
  const jacketId = 'jacket-' + rawId;
  const faceRx = 83 * appearance.faceWidth / 100;
  const faceRy = 114 * appearance.faceLength / 100;
  const shoulderHalf = 110 * appearance.bodyWidth / 100;
  const bodyBottom = 585 * appearance.bodyHeight / 100;
  const isDark = appearance.glasses === 'shades';
  const collar = appearance.outfit === 'western' ? '#e2c39a' : '#e7e9e8';
  const noPhotoHair = appearance.hair === 'photo' && !photo;

  return (
    <svg viewBox="0 0 500 640" role="img" aria-label={'Custom character preview for ' + displayName}
      className="h-auto w-full max-w-lg rounded-3xl bg-[#111923]">
      <defs>
        <radialGradient id={'light-' + rawId} cx="50%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#385875" />
          <stop offset="100%" stopColor="#0a0c13" />
        </radialGradient>
        <linearGradient id={jacketId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={appearance.outfitColor} />
          <stop offset="100%" stopColor="#111923" />
        </linearGradient>
        <clipPath id={faceId}>
          <ellipse cx="250" cy="198" rx={faceRx} ry={faceRy} />
        </clipPath>
      </defs>
      <rect width="500" height="640" fill={'url(#light-' + rawId + ')'} />
      <path d="M 65 0 L 175 0 L 268 450 L 210 450 Z" fill="#ffffff" opacity=".035" />
      <path d="M 435 0 L 325 0 L 232 450 L 290 450 Z" fill="#ffffff" opacity=".03" />
      <ellipse cx="250" cy="615" rx="165" ry="20" fill="#000000" opacity=".3" />
      <path d={'M ' + (250 - shoulderHalf) + ' 347 Q 166 314 212 309 L 287 309 Q 330 314 ' + (250 + shoulderHalf) + ' 347 L ' + (250 + shoulderHalf + 25) + ' ' + bodyBottom + ' L ' + (250 - shoulderHalf - 25) + ' ' + bodyBottom + ' Z'}
        fill={'url(#' + jacketId + ')'} stroke="#000000" strokeWidth="3" opacity=".95" />
      {appearance.outfit === 'street' && <path d="M 210 320 Q 250 430 290 320 L 305 340 L 270 446 L 230 446 L 195 340 Z" fill="#b6b4a8" />}
      {appearance.outfit === 'studio' && <path d="M 224 327 L 250 474 L 276 327 L 287 350 L 250 492 L 213 350 Z" fill="#2e343b" />}
      {appearance.outfit === 'stage' && <path d="M 245 342 L 255 342 L 263 600 L 237 600 Z" fill="#d4b15b" opacity=".6" />}
      <path d="M 202 304 L 213 347 L 250 411 L 287 347 L 298 304 L 276 317 L 250 366 L 224 317 Z" fill={collar} stroke="#1a1a1b" strokeWidth="3" />
      <path d="M 219 284 L 219 340 Q 250 356 281 340 L 281 284 Z" fill={appearance.skin} />
      <ellipse cx="250" cy="201" rx={faceRx + 5} ry={faceRy + 5} fill="#141c27" opacity=".75" />
      <ellipse cx="250" cy="198" rx={faceRx} ry={faceRy} fill={appearance.skin} />
      <g clipPath={'url(#' + faceId + ')'}>
        {photo ? <image href={photo} x={250 - faceRx} y={198 - faceRy} width={faceRx * 2} height={faceRy * 2} preserveAspectRatio="xMidYMid slice" />
        : <>
          <ellipse cx="216" cy="195" rx="11" ry="7" fill="#fff" opacity=".85" />
          <ellipse cx="284" cy="195" rx="11" ry="7" fill="#fff" opacity=".85" />
          <circle cx="217" cy="195" r="5" fill="#273240" />
          <circle cx="283" cy="195" r="5" fill="#273240" />
          <path d="M 238 208 L 230 251 Q 250 260 269 250" stroke="#6c4535" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 231 274 Q 250 284 269 274" stroke="#6c4535" strokeWidth="3" fill="none" />
        </>}
        {(appearance.hair !== 'photo' || noPhotoHair) && appearance.hair !== 'cap' && (
          <path d={appearance.hair === 'long'
            ? 'M 161 195 Q 156 69 254 73 Q 361 66 336 216 L 317 317 L 309 192 Q 270 132 195 166 L 187 305 Z'
            : appearance.hair === 'slick'
            ? 'M 162 190 Q 166 93 243 77 Q 331 74 341 164 Q 282 112 213 145 Q 178 142 162 190 Z'
            : 'M 161 184 Q 170 91 249 85 Q 334 87 339 185 Q 304 133 260 141 Q 205 132 161 184 Z'}
            fill={appearance.hairColor} stroke="#17171a" strokeWidth="3" />
        )}
        {(appearance.beard === 'stubble' || appearance.beard === 'full') && (
          <path d="M 186 252 Q 194 303 250 320 Q 306 303 314 252 L 288 291 Q 248 304 212 287 Z"
            fill={appearance.beardColor} opacity={appearance.beard === 'stubble' ? .28 : .88} />
        )}
        {(appearance.beard === 'full' || appearance.beard === 'mustache') && (
          <path d="M 212 265 Q 231 250 250 264 Q 271 250 290 265 Q 272 281 250 273 Q 231 281 212 265 Z"
            fill={appearance.beardColor} />
        )}
      </g>
      {appearance.hair === 'cap' && (
        <g><path d="M 167 166 Q 177 80 250 82 Q 327 79 336 167 Q 246 144 167 166 Z" fill={appearance.hairColor} stroke="#111" strokeWidth="4" />
        <path d="M 167 165 Q 262 148 357 168 L 347 181 Q 260 175 166 177 Z" fill={appearance.hairColor} stroke="#111" strokeWidth="3" /></g>
      )}
      {appearance.glasses !== 'none' && (
        <g fill={isDark ? '#111c29' : '#c7e6f2'} fillOpacity={isDark ? .84 : .18} stroke="#111923" strokeWidth="5">
          <rect x="188" y="185" rx="13" width="53" height="40" />
          <rect x="259" y="185" rx="13" width="53" height="40" />
          <path d="M 241 195 Q 250 188 259 195" fill="none" />
        </g>
      )}
      {appearance.outfit === 'western' && <g fill="#d8b16c"><path d="M 170 377 L 198 382 L 213 400 L 189 391 Z"/><path d="M 330 377 L 302 382 L 287 400 L 311 391 Z"/></g>}
      <rect x="16" y="568" width="468" height="56" rx="17" fill="#07090d" opacity=".80" />
      <text x="250" y="590" fontSize="12" textAnchor="middle" fill="#91c6dd" fontWeight="bold" letterSpacing="3">PIPE DREAMS / CHARACTER VAULT</text>
      <text x="250" y="613" fontSize="18" textAnchor="middle" fill="#fff" fontWeight="bold">{displayName.slice(0, 29)}</text>
    </svg>
  );
}

function Adjustment({ label, value, onChange, min = 75, max = 125 }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return <label className="block text-sm text-white/75">
    <span className="mb-1 flex justify-between gap-3"><span>{label}</span><strong className="text-cyan-300">{value}%</strong></span>
    <input type="range" className="w-full accent-cyan-300" min={min} max={max} step={1} value={value}
      onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

function Choice<T extends string>({ label, choices, selected, onSelect }: {
  label: string;
  choices: T[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return <div>
    <div className="mb-2 text-sm text-white/65">{label}</div>
    <div className="flex flex-wrap gap-2">
      {choices.map(choice => <button key={choice} type="button" onClick={() => onSelect(choice)}
        className={'rounded-lg border px-3 py-2 text-xs font-semibold capitalize ' +
          (selected === choice ? 'border-cyan-300 bg-cyan-300/15 text-cyan-200' : 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10')}>
        {choice === 'photo' ? 'My natural hair' : choice}
      </button>)}
    </div>
  </div>;
}

export default function PipeDreamsCharacterCreator({ onSave, onClose }: CharacterCreatorProps) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [vault, setVault] = useState<PipeDreamsCharacter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('My Character');
  const [photo, setPhoto] = useState<string | null>(null);
  const [facePoints, setFacePoints] = useState<FacePoint[] | null>(null);
  const [view, setView] = useState<CharacterCameraView>('full');
  const [appearance, setAppearance] = useState<CharacterAppearance>({ ...DEFAULT_APPEARANCE });
  const [message, setMessage] = useState('Your selfie stays in this browser unless you explicitly export it.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVault(readVault());
    setLoaded(true);
  }, []);

  const update = <K extends keyof CharacterAppearance,>(key: K, value: CharacterAppearance[K]) => {
    setAppearance(previous => ({ ...previous, [key]: value }));
  };

  // v0.2.1: take the skin and hair colour from the selfie so the head, neck and hands match the face.
  const matchColors = async (data: string, points: FacePoint[]) => {
    const colors = await sampleFaceColors(data, points);
    if (colors) setAppearance(previous => ({ ...previous, skin: colors.skin, hairColor: colors.hair, beardColor: colors.hair }));
  };

  const importPhoto = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await resizeSelfie(file);
      setPhoto(data);
      setFacePoints(null);
      setMessage('Building the 3D face mesh from your selfie...');
      try {
        const points = await scanSelfie(data);
        setFacePoints(points);
        await matchColors(data, points);
        setView('face');
        setMessage('3D face scan complete. Rotate the head and refine your likeness.');
      } catch (scanError) {
        setFacePoints(null);
        setMessage(scanError instanceof Error ? 'Face scan unavailable: ' + scanError.message : 'Face scanning failed. Retry with a clear selfie.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open that photo.');
    } finally {
      setBusy(false);
    }
  };

  const chooseCharacter = (character: PipeDreamsCharacter) => {
    setSelectedId(character.id);
    setName(character.displayName);
    setPhoto(character.photoDataUrl);
    setFacePoints(character.facePoints || null);
    setAppearance({ ...DEFAULT_APPEARANCE, ...character.appearance });
    setMessage('Editing saved character. Save to keep your changes.');
  };

  const newCharacter = () => {
    setSelectedId(null);
    setName('My Character');
    setPhoto(null);
    setFacePoints(null);
    setView('full');
    setAppearance({ ...DEFAULT_APPEARANCE });
    setMessage('New character. Add a selfie or build one manually.');
  };

  const save = () => {
    if (!loaded) return;
    const now = new Date().toISOString();
    const original = vault.find(item => item.id === selectedId);
    const character: PipeDreamsCharacter = {
      id: original?.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'pd-character-' + Date.now()),
      version: CHARACTER_CREATOR_VERSION,
      displayName: name.trim().slice(0, 50) || 'My Character',
      photoDataUrl: photo,
      facePoints,
      appearance: { ...appearance },
      createdAt: original?.createdAt || now,
      updatedAt: now,
    };
    const next = [...vault.filter(item => item.id !== character.id), character].slice(-6);
    try {
      localStorage.setItem(CHARACTER_VAULT_KEY, JSON.stringify(next));
      setVault(next);
      setSelectedId(character.id);
      setMessage('Character saved locally. Ready for PULSE.');
      onSave?.(character);
    } catch {
      setMessage('Device storage is full or unavailable. Export a copy before leaving this page.');
    }
  };

  const exportCharacter = () => {
    const data = {
      schema: 'pipe-dreams.character',
      version: CHARACTER_CREATOR_VERSION,
      character: {
        id: selectedId || 'unsaved',
        version: CHARACTER_CREATOR_VERSION,
        displayName: name.trim() || 'My Character',
        photoDataUrl: photo,
        facePoints,
        appearance,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pipe-dreams-character-v' + CHARACTER_CREATOR_VERSION + '.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Exported a character profile. It includes your selfie if one was selected.');
  };

  return <section className="mx-auto w-full max-w-6xl rounded-3xl border border-white/15 bg-[#090e16] p-4 text-white shadow-2xl md:p-7">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-cyan-300">PIPE DREAMS STUDIO · CHARACTER VAULT</p>
        <h2 className="mt-1 text-2xl font-black md:text-3xl">MY CHARACTER <span className="text-cyan-300">v{CHARACTER_CREATOR_VERSION}</span></h2>
        <p className="mt-1 max-w-2xl text-sm text-white/55">Take a selfie, scan facial landmarks, sculpt the 3D face and body, and save an avatar you can rotate and customize.</p>
      </div>
      {onClose && <button type="button" onClick={onClose}
        className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10">Close</button>}
    </div>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div>
        <Character3DStage photo={photo} facePoints={facePoints} appearance={appearance} view={view} height={540} />
        <div className="mt-3 flex flex-wrap gap-2" aria-label="3D camera views">
          {(['full','face','three-quarter','side'] as CharacterCameraView[]).map(option =>
            <button key={option} type="button" onClick={() => setView(option)}
              className={'rounded-lg border px-3 py-2 text-xs font-semibold capitalize ' +
                (view === option ? 'border-cyan-300 bg-cyan-300/15 text-cyan-100' : 'border-white/20 bg-white/5 text-white/75')}>
              {option === 'three-quarter' ? '¾ turn' : option === 'full' ? 'Full body' : option === 'face' ? 'Face close-up' : 'Side'}
            </button>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => cameraInput.current?.click()} disabled={busy}
            className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#06121b] disabled:opacity-50">Take a selfie</button>
          <button type="button" onClick={() => uploadInput.current?.click()} disabled={busy}
            className="rounded-xl border border-white/25 px-4 py-3 text-sm font-semibold hover:bg-white/10 disabled:opacity-50">Use a photo</button>
          {photo && !facePoints && <button type="button" disabled={busy} onClick={() => {
            setBusy(true);
            void scanSelfie(photo).then(async points => {
              setFacePoints(points);
              await matchColors(photo, points);
              setView('face');
              setMessage('3D face scan complete. Refine your character and save.');
            }).catch(error => setMessage('Face scan failed: ' + (error instanceof Error ? error.message : 'try again')))
              .finally(() => setBusy(false));
          }} className="rounded-xl border border-cyan-300/40 px-4 py-3 text-sm text-cyan-200 disabled:opacity-40">Retry 3D scan</button>}
          {photo && <button type="button" onClick={() => { setPhoto(null); setFacePoints(null); }}
            className="rounded-xl border border-white/15 px-4 py-3 text-sm text-white/70 hover:bg-white/10">Remove photo</button>}
        </div>
        <input ref={cameraInput} type="file" accept="image/*" capture="user" className="hidden"
          aria-label="Take a selfie" onChange={event => { void importPhoto(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={uploadInput} type="file" accept="image/*" className="hidden"
          aria-label="Choose an existing photo" onChange={event => { void importPhoto(event.target.files?.[0]); event.target.value = ''; }} />
        <p className="mt-3 text-xs leading-5 text-white/50">
Your selfie is turned into a 3D face on this device and is not sent to a server. The face is straightened to look ahead, and skin and hair colour are picked up from the photo; change them below if they are off. The back of the head and the hair shape are a best guess. A front-on photo in even light works best. Saved and exported profiles include the photo.
        </p>
      </div>

      <div className="space-y-5">
        <label className="block">
          <span className="mb-1 block text-sm text-white/65">Character name</span>
          <input value={name} maxLength={50} onChange={event => setName(event.target.value)}
            className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3 outline-none focus:border-cyan-300"
            placeholder="Name your character" />
        </label>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-white/80">Face &amp; build</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Adjustment label="Face width" value={appearance.faceWidth} onChange={v => update('faceWidth', v)} />
            <Adjustment label="Face length" value={appearance.faceLength} onChange={v => update('faceLength', v)} />
            <Adjustment label="Jaw width" value={appearance.jawWidth} onChange={v => update('jawWidth', v)} min={70} max={140} />
            <Adjustment label="Cheek fullness" value={appearance.cheekWidth} onChange={v => update('cheekWidth', v)} min={70} max={140} />
            <Adjustment label="Nose width" value={appearance.noseWidth} onChange={v => update('noseWidth', v)} min={70} max={140} />
            <Adjustment label="Nose projection" value={appearance.noseDepth} onChange={v => update('noseDepth', v)} min={65} max={150} />
            <Adjustment label="Eye spacing" value={appearance.eyeSpacing} onChange={v => update('eyeSpacing', v)} min={75} max={125} />
            <Adjustment label="Body width" value={appearance.bodyWidth} onChange={v => update('bodyWidth', v)} />
            <Adjustment label="Body height" value={appearance.bodyHeight} min={90} max={110} onChange={v => update('bodyHeight', v)} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-white/70">
            <label className="flex items-center gap-2">Skin tone <input type="color" value={appearance.skin}
              onChange={event => update('skin', event.target.value)} className="h-9 w-11 cursor-pointer" /></label>
            <label className="flex items-center gap-2">Hair color <input type="color" value={appearance.hairColor}
              onChange={event => update('hairColor', event.target.value)} className="h-9 w-11 cursor-pointer" /></label>
            <label className="flex items-center gap-2">Beard color <input type="color" value={appearance.beardColor}
              onChange={event => update('beardColor', event.target.value)} className="h-9 w-11 cursor-pointer" /></label>
          </div>
        </div>
        <Choice label="Hair style" choices={HAIR_OPTIONS} selected={appearance.hair} onSelect={v => update('hair', v)} />
        <Choice label="Facial hair" choices={BEARD_OPTIONS} selected={appearance.beard} onSelect={v => update('beard', v)} />
        <Choice label="Eyewear" choices={GLASSES_OPTIONS} selected={appearance.glasses} onSelect={v => update('glasses', v)} />
        <Choice label="Outfit" choices={OUTFIT_OPTIONS} selected={appearance.outfit} onSelect={v => update('outfit', v)} />
        <div>
          <p className="mb-2 text-sm text-white/65">Outfit color</p>
          <div className="flex flex-wrap items-center gap-3">
            {COLOR_SWATCHES.map(color => <button key={color} type="button"
              aria-label={'Choose outfit color ' + color} onClick={() => update('outfitColor', color)}
              className={'h-9 w-9 rounded-full border-2 ' + (appearance.outfitColor === color ? 'border-cyan-300' : 'border-white/20')}
              style={{ background: color }} />)}
            <input type="color" aria-label="Custom outfit color" value={appearance.outfitColor}
              onChange={event => update('outfitColor', event.target.value)} className="h-9 w-11 cursor-pointer" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-5">
          <button type="button" onClick={save} disabled={!loaded || busy}
            className="rounded-xl bg-cyan-300 px-5 py-3 font-bold text-[#06121b] disabled:opacity-60">Save character to PULSE</button>
          <button type="button" onClick={exportCharacter}
            className="rounded-xl border border-white/25 px-4 py-3 font-semibold hover:bg-white/10">Export profile</button>
          <button type="button" onClick={newCharacter}
            className="rounded-xl border border-white/15 px-4 py-3 text-white/70 hover:bg-white/10">Start new</button>
        </div>
        <p role="status" aria-live="polite" className="min-h-8 text-sm text-cyan-200">{message}</p>
      </div>
    </div>

    {vault.length > 0 && <div className="mt-7 border-t border-white/10 pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Saved characters ({vault.length}/6)</h3>
        <span className="text-xs text-white/40">Stored on this device</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {vault.map(character => <button type="button" key={character.id}
          onClick={() => chooseCharacter(character)}
          className={'rounded-xl border px-4 py-3 text-sm ' +
            (selectedId === character.id ? 'border-cyan-300 bg-cyan-300/15' : 'border-white/20 bg-white/5 hover:bg-white/10')}>
          {character.displayName}
        </button>)}
      </div>
    </div>}
  </section>;
}
