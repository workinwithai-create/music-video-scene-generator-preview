import type { FacePoint } from './headLayout_v0.2.1';

/**
 * Reads the skin and hair colour out of the selfie, so the rest of the head, the neck and the hands
 * match the face instead of using a stock skin tone. Runs in the browser; nothing is uploaded.
 */
export interface FaceColors {
  skin: string;
  hair: string;
}

const hex = (rgb: number[]) => '#' + rgb.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('');
const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function sampleFaceColors(dataUrl: string, points: FacePoint[]): Promise<FaceColors | null> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height || points.length < 468) return null;
    context.drawImage(image, 0, 0);

    const patch = (x: number, y: number, radius: number): number[] | null => {
      const size = Math.max(2, Math.round(radius * 2));
      const left = Math.round(Math.max(0, Math.min(canvas.width - size, x * canvas.width - size / 2)));
      const top = Math.round(Math.max(0, Math.min(canvas.height - size, y * canvas.height - size / 2)));
      const data = context.getImageData(left, top, size, size).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
      const count = data.length / 4;
      return count ? sum.map(value => value / count) : null;
    };

    const faceWidth = Math.abs(points[454][0] - points[234][0]) * canvas.width;
    const radius = Math.max(3, faceWidth * 0.035);
    // Cheeks and forehead: clear of eyes, lips, beard and most shadows. The median ignores one odd patch (a highlight, glasses).
    const skinPatches = [50, 280, 205, 425, 151].map(i => patch(points[i][0], points[i][1], radius)).filter((rgb): rgb is number[] => !!rgb);
    if (skinPatches.length < 3) return null;
    const skin = [0, 1, 2].map(channel => median(skinPatches.map(rgb => rgb[channel])));

    // Hair: a little above the top of the forehead, following the tilt of the head.
    const upX = points[10][0] - points[152][0], upY = points[10][1] - points[152][1];
    const hairPatches = [0.1, 0.16].map(step => patch(points[10][0] + upX * step, points[10][1] + upY * step, radius * 1.3)).filter((rgb): rgb is number[] => !!rgb);
    const hair = hairPatches.length ? [0, 1, 2].map(channel => Math.min(...hairPatches.map(rgb => rgb[channel]))) : skin.map(value => value * 0.35);
    return { skin: hex(skin), hair: hex(hair) };
  } catch {
    return null;
  }
}
