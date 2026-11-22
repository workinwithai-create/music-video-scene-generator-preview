import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export type FacePoint = [number, number, number];

/**
 * Face data remains on-device. The downloaded ML model/WASM is a static runtime.
 * Reject invalid scans instead of pretending that the reference photo is a 3D head.
 */
let worker: Promise<FaceLandmarker> | null = null;

async function getFaceDetector(): Promise<FaceLandmarker> {
  if (!worker) {
    worker = (async () => {
      const files = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
      );
      return FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
      });
    })().catch(error => {
      worker = null;
      throw error;
    });
  }
  return worker;
}

export async function scanSelfie(dataUrl: string): Promise<FacePoint[]> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const detector = await getFaceDetector();
  const result = detector.detect(image);
  const landmarks = result.faceLandmarks[0];
  if (!landmarks || landmarks.length < 468) {
    throw new Error('No clear face found. Try a front-facing photo in even light without sunglasses.');
  }
  const coords: FacePoint[] = landmarks.slice(0, 468).map(p => [
    Number(p.x.toFixed(5)),
    Number(p.y.toFixed(5)),
    Number(p.z.toFixed(5)),
  ]);
  const left = coords[234], right = coords[454], top = coords[10], chin = coords[152];
  if (!left || !right || !top || !chin ||
      right[0] - left[0] < 0.12 || chin[1] - top[1] < 0.2) {
    throw new Error('Face scan did not pass the quality check. Try facing the camera directly.');
  }
  return coords;
}
