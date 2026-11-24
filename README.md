# Music Video Scene Generator + Runway Gen-3/Gen-4 Integration

Full-featured React + TypeScript component for creating cinematic music video scenes with **Suno** and **Runway** integration.

## What's New (Runway Integration)
- Per-scene "Generate Video Clip" buttons
- Support for Gen-3 Turbo, Gen-4 Turbo, and Gen-4.5
- Configurable duration + live cost estimation
- Clean settings panel for API key (with production security notes)
- Ready-to-extend architecture — currently uses simulation with clear `TODO` comments
- Generated videos are tracked per scene and can be replayed

## Files
- `MusicVideoSceneGenerator-with-Runway.tsx` — Complete component with Runway support
- `MusicVideoSceneGenerator.tsx` — Original version (Suno only)

## How to Integrate Runway (Production)

### Recommended Architecture (for ReleaseForge / Supabase + Vite)

**Frontend (this component)**
- Collects prompt + settings
- Calls your own protected endpoint: `POST /api/runway/generate`

**Backend (Supabase Edge Function or Vercel API Route)**
```ts
// Example: /supabase/functions/runway-generate/index.ts
import { RunwayML } from '@runwayml/sdk';

Deno.serve(async (req) => {
  const { prompt, model, duration, ratio } = await req.json();

  const client = new RunwayML({ apiKey: Deno.env.get('RUNWAY_API_KEY')! });

  const task = await client.imageToVideo.create({
    model,
    promptText: prompt,
    ratio,
    duration,
  }).waitForTaskOutput();

  return new Response(JSON.stringify({ videoUrl: task.outputUrl }));
});
```

Then in the component, replace the simulation in `generateRunwayVideo()` with a real `fetch` call to your backend.

### Security Notes
- Never expose your Runway API key in the browser.
- Store it in Supabase secrets or environment variables.
- The current implementation shows a password input only for local testing / development.

## Quick Start
1. Copy `MusicVideoSceneGenerator-with-Runway.tsx` into your components
2. `npm install lucide-react`
3. Import and render the component
4. Use "Load Demo" → Generate Scenes → Try Runway buttons

## Future Enhancements (we can build next)
- Real backend integration with `@runwayml/sdk`
- Keyframe image generation → Image-to-Video flow
- Batch video generation for full song
- Credit usage dashboard
- Webhook status polling for long tasks

Built with the `auto-build-features` skill — ready for production extension.

## PULSE Performance Room v0.1.0

PULSE turns the webcam into a rhythm-game controller for Pipe Dreams Studio.

Current MVP:
- Camera-based motion-zone controller (left/right/top/bottom/center)
- BPM-driven song clock with four-beat count-in
- Beat-synced cues: step, grab, kick, point, duck, turn, lean, throw, guitar hit, mic grab, free move
- Timing, movement, energy, score, and combo tracking
- Game, Director, and Character modes
- Assist control for timing/motion forgiveness
- Timestamped choreography event capture
- JSON export using the `pipe-dreams.pulse.motion-events` schema
- Optional Pipe Dreams song-session input for BPM/title/duration handoff

The webcam frames stay local in this MVP. Only derived motion energy and timing events are stored in component state or exported.

### Integration contract

`PIPES / HIGH-DEA -> PipeDreamsSongSession -> PULSE -> PulseMotionEvent[] -> Music Video Room`

Future tracking can replace the motion-zone detector with MediaPipe/Pose landmarks without changing the event contract.



## My Character v0.1.0 + PULSE v0.1.1

The PULSE preview now includes **Build My Character**, an in-browser, photo-assisted character creator:

- On a phone, **Take a selfie** requests the front-facing camera using the browser's file capture control; **Use a photo** also works.
- The photo is resized and stored locally for the face reference; a non-photo illustrated character is available too.
- Edit face width/length, body proportions, skin tone, hair/color, facial hair, eyewear, stage outfit and colors in a live preview.
- Save up to six profiles in this device's browser Character Vault and export a portable JSON character profile with embedded selfie.
- Saving a character selects **Character** mode in PULSE and retains the chosen display name across local page reloads.
- PULSE v0.1.1 fixes background-tab beat-cue recovery, makes camera-active mode selection truly disabled, and moves motion-event callbacks outside React state updaters.

**Current fidelity:** The preview is a 2.5D photo-faced illustration, **not an automatic 3D facial reconstruction or likeness engine**. A single selfie cannot reliably recover exact facial depth, hair geometry or profile view. The stored profile schema separates identity/appearance from performance events so a future 3D face/rig service can reuse it. PULSE motion detection still uses coarse camera motion zones, not full skeletal tracking. The Character Vault currently uses device-local browser storage, not cross-device account sync.

**Privacy:** Camera frames are not uploaded by this preview. The compressed selfie is stored locally only after **Save character**; **Export profile** writes a JSON file containing the photo (if selected). Do not share that export publicly unless you intend to share the embedded image.

**Quick test:** Launch the preview, open **Build My Character**, take or upload a selfie, adjust face/outfit, save, confirm Character mode displays your name, reload the page and reopen the vault. Then turn on the webcam, play beats, background/restore the tab and confirm cues continue. For Mac/iPhone camera access, use HTTPS or localhost.


## Character Studio 3D v0.2.0 (replaces 2D editor in the live preview)

This is the first genuinely **3D** character-building experiment for the Madden-inspired feature. The legacy 2D editor remains preserved as `PipeDreamsCharacterCreator_v0.1.0.tsx`.

- Upload a clear front-facing selfie on your phone.
- `@mediapipe/tasks-vision` extracts 468 local facial landmark coordinates from the photo.
- The editor triangulates face points (Delaunay), masks triangles against the facial oval, uses the scanned face coordinates to estimate surface depth, and texture-maps the selfie to the 3D head.
- A 3D body with legs, boots, torso, neck, arms and a skull can be rotated and zoomed. Camera shortcuts: Full Body, Face Close-up, ¾ Turn, Side. Camera works with mouse or touch.
- Face width and length, jaw, cheek, nose width/projection, eye spacing, body width/height, hair, beard, glasses, and outfits are editable in the live model.
- Faces and appearance settings save together as a portable character profile in the existing local vault.
- PULSE v0.1.2 displays the chosen 3D character next to the camera and translates broad motion zones into basic torso/arm animation.

**Integrity / limitations:** This does not synthesize an unseen back of the head or reconstruct an exact skull from one photo. It is a textured face mesh with estimated depth; the remaining geometry and hair are procedural. This is not a production-ready skinned GLB/avatar rig, and **PULSE v0.1.2 still does not have full-body skeletal tracking**. The model and WASM are downloaded over the network, but selfie pixels are processed in the browser. If scanning fails, the UI displays an error and keeps a generic 3D head; it does not claim the generic head is a scan.

**Test acceptance on phone:** Take a selfie with good light -> wait for '3D face scan complete' -> drag to rotate from front to side -> adjust jaw/nose -> change outfits -> save -> refresh -> reopen saved character -> select Character mode in PULSE -> confirm a 3D avatar is present -> use camera and verify coarse motion response.

**Future v0.3.0:** Proper humanoid skeleton and facial blendshape rig, two-photo/profile reconstruction, likeness QA, staged clothing asset sets, importable/exportable GLB, face capture from live video, and reliable full-body pose tracking.


## PULSE v0.2.0 (current preview)

The preview now opens `PipeDreamsPulsePerformanceRoom_v0.2.0.tsx`. Earlier versions are kept untouched.

**What changed from v0.1.2**

- **Real body tracking.** MediaPipe pose tracking runs in the browser (`poseTracker_v0.2.0.ts`). Each move is judged by its shape (hand above the shoulder, arm straight out, shoulders dropped, and so on) instead of by pixels changing in a region. The maths lives in `pulseTracking_v0.2.0.ts`.
- **Your character copies you.** `PulseAvatar_v0.2.0.tsx` is a jointed figure (shoulders, elbows, hips, knees, head) that mirrors your arms, lean, sidestep, duck and, when the camera can see them, your legs. It wears the saved My Character look and scanned face. Until you build one, a stand-in performs.
- **Sound.** Click track with a four-beat count-in, plus hit and miss sounds (`pulseAudio_v0.2.0.ts`). No audio files.
- **A run has an ending.** Pick 8 to 64 bars; the run finishes on a results card with score, Perfect / Nice / Close / Miss counts and best combo.
- **Three modes that differ.** Game prompts moves. Director gives no prompts and writes down each move you choose to do against the beat. Free play scores and records nothing.
- **Settings work while the camera is on.** v0.1.x froze every control once the camera started.
- **Pipe Dreams Studio look**, phone first: one screen holds the move bar, the stage and Start. The first download is about 90 KB compressed (was about 375 KB); the 3D stage and the character editor load after.

**Fallback.** If body tracking cannot load, or cannot see you, PULSE falls back to the v0.1 motion-zone check and says so on screen ("Motion only"). Kick uses the motion-zone check whenever your legs are out of frame.

**Event contract.** Unchanged: schema `pipe-dreams.pulse.motion-events`, same fields and beat numbering. v0.2.0 adds one optional field per event, `tracking` (`pose` or `zones`), and always fills `character`.

**Privacy.** Camera frames never leave the device. The tracking program and its model file are downloaded from jsDelivr and Google storage the first time.

**Checks.** `npm test` runs 16 tests of the tracking and scoring maths on made-up skeletons (needs Node 22.18 or newer). The page was also run in headless Chrome with a photo of a person as a fake camera: tracking loaded, the character matched the pose, and Game, Director and Free play ran start to finish, with and without body tracking.

**Not yet checked or built**

- Nobody has played it on a real phone camera yet. How strict each move feels (how far you must step, how fast a throw is) was set by reasoning and by the tests, and will need tuning after real play. Open **Tracking details** to watch each move's bar fill as you do it.
- Tracking speed on a phone is unmeasured. PULSE halves its tracking rate by itself if the phone is slow.
- The click is the only music. Playing to a real song needs the song and its tempo from the Pipe Dreams song library (the `session` prop is ready for it).
- The My Character editor still previews the older, rounder body. On stage the character uses the new jointed body with the same face, hair, beard, glasses and colours.
- Turns are judged only by the shoulders looking narrower; the depth a single camera reports is too rough for more.

**Phone test.** Open the preview, tap Start, allow the camera, prop the phone so the small picture shows your head, arms and hips, and wait for "Tracking on". Raise a hand, lean, step sideways and check the character follows like a mirror. Play 16 bars and check the results card. Switch to Director, do five clear moves and check they are listed with bar and beat.

