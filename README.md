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
