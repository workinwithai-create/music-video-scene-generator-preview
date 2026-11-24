import type { PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * Body tracking for PULSE v0.2.0. Runs fully in the browser: the camera picture is never
 * uploaded. Only the tracking program (WASM) and its model file are downloaded, once.
 *
 * Kept on the same pinned MediaPipe version as the selfie face scan (faceScan_v0.2.0.ts).
 */
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let loading: Promise<PoseLandmarker> | null = null;

/** Loads the body tracker once and reuses it. Tries the graphics chip first, then the plain processor. */
export function loadPoseTracker(): Promise<PoseLandmarker> {
  if (!loading) {
    loading = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(WASM_BASE);
      const create = (delegate: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        return await create('GPU');
      } catch {
        return await create('CPU');
      }
    })().catch(error => {
      loading = null; // let the next "camera on" try again
      throw error;
    });
  }
  return loading;
}
