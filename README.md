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
