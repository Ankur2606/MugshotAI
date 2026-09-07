"use client";

import type { Human, Config, Result, FaceResult } from "@vladmandic/human";

/**
 * One Human instance for the whole session, loaded lazily in the browser.
 * The probe face and every candidate face go through this same instance, so
 * their descriptors come from the identical encoder and the similarity number
 * actually means something.
 */

export const ENCODER_ID = "human/blazeface+facemesh+faceres";

export const probeConfig: Partial<Config> = {
  // Weights are served from public/models, so nothing is fetched from a CDN.
  modelBasePath: "/models/",
  backend: "webgl",
  cacheSensitivity: 0,
  warmup: "none",
  filter: { enabled: true, equalization: false },
  face: {
    enabled: true,
    detector: { rotation: true, maxDetected: 8, minConfidence: 0.2, return: false },
    mesh: { enabled: true },
    iris: { enabled: true },
    description: { enabled: true }, // produces the 1024-d embedding
    emotion: { enabled: false },
    antispoof: { enabled: true },
    liveness: { enabled: true },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
};

let instance: Human | null = null;
let loading: Promise<Human> | null = null;

// Several components watch the load (the gate ties its doors to it, the
// specimen station gates its buttons on it), so progress goes through a
// subscriber set rather than a single callback: late subscribers immediately
// hear the latest stage.
let lastStage = "cold";
const listeners = new Set<(msg: string) => void>();

function announce(msg: string) {
  lastStage = msg;
  for (const l of listeners) l(msg);
}

export function loadEngine(onProgress?: (msg: string) => void): Promise<Human> {
  if (onProgress) {
    listeners.add(onProgress);
    onProgress(lastStage);
  }
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;

  loading = (async () => {
    announce("loading runtime");
    // next.config.ts aliases this specifier to Human's browser ESM bundle;
    // left alone it resolves to the Node build and drags in tfjs-node.
    const { default: HumanCtor } = await import("@vladmandic/human");
    const human = new HumanCtor(probeConfig);
    announce("loading engine");
    await human.load();
    announce("warming up");
    await human.warmup();
    announce("ready");
    instance = human;
    return human;
  })();

  return loading;
}

export type FaceReading = {
  embedding: number[];
  /** detector confidence, 0..1 */
  score: number;
  box: [number, number, number, number];
  /** Normalized bounding box (0..1) relative to image dimensions */
  boxRaw?: [number, number, number, number];
  /** mesh points in input pixel space, for the overlay */
  mesh: Array<[number, number]>;
  /** anti-spoof confidence that this is a real face, 0..1 */
  real: number | null;
  /** liveness confidence, 0..1 */
  live: number | null;
  age: number | null;
  gender: string | null;
};

function toReading(face: FaceResult): FaceReading | null {
  if (!face.embedding || face.embedding.length === 0) return null;
  return {
    embedding: Array.from(face.embedding),
    score: face.faceScore ?? face.score ?? 0,
    box: face.box as [number, number, number, number],
    boxRaw: face.boxRaw as [number, number, number, number] | undefined,
    mesh: (face.mesh ?? []).map((p) => [p[0], p[1]] as [number, number]),
    real: typeof face.real === "number" ? face.real : null,
    live: typeof face.live === "number" ? face.live : null,
    age: typeof face.age === "number" ? face.age : null,
    gender: face.gender ?? null,
  };
}

/** Detect and encode the single most confident face in the input. */
export async function readFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceReading | null> {
  const human = await loadEngine();
  const result: Result = await human.detect(input, probeConfig);
  if (!result.face || result.face.length === 0) return null;
  const best = [...result.face].sort((a, b) => (b.faceScore ?? 0) - (a.faceScore ?? 0))[0];
  return toReading(best);
}

/**
 * Fast face reading specifically for candidate thumbnails during adjudication.
 * - Single-face focus (maxDetected: 1)
 * - Antispoof, liveness, and iris disabled (static candidate web images don't require liveness verification)
 * - Drastically reduces GPU/WebGL load during batch scoring of candidate images.
 */
const candidateScoreConfig: Partial<Config> = {
  face: {
    enabled: true,
    detector: { rotation: true, maxDetected: 1, minConfidence: 0.25, return: false },
    mesh: { enabled: true },
    iris: { enabled: false },
    description: { enabled: true },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
  },
};

export async function scoreCandidateFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceReading | null> {
  const human = await loadEngine();
  let result: Result = await human.detect(input, candidateScoreConfig);

  // If initial detection on small input image found nothing, try upscaling the canvas
  if ((!result.face || result.face.length === 0) && typeof document !== "undefined") {
    try {
      const w =
        input instanceof HTMLVideoElement
          ? input.videoWidth
          : (input as HTMLImageElement).naturalWidth || (input as HTMLCanvasElement).width || 0;
      const h =
        input instanceof HTMLVideoElement
          ? input.videoHeight
          : (input as HTMLImageElement).naturalHeight || (input as HTMLCanvasElement).height || 0;

      if (w > 0 && h > 0 && (w < 400 || h < 400)) {
        const scale = Math.min(3, Math.max(1.5, 480 / Math.max(w, h)));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
          const retryResult = await human.detect(canvas, candidateScoreConfig);
          if (retryResult.face && retryResult.face.length > 0) {
            const face = retryResult.face[0];
            if (face.box) {
              face.box = [
                face.box[0] / scale,
                face.box[1] / scale,
                face.box[2] / scale,
                face.box[3] / scale,
              ];
            }
            result = retryResult;
          }
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  if (!result.face || result.face.length === 0) return null;
  const initialFace = result.face[0];
  const reading = toReading(initialFace);
  if (!reading) return null;

  // Super-resolution crop for low-px faces (< 48px):
  // When the detected face is small (e.g. 16px or 33px in full-body or thumbnail photos),
  // crop the facial region with 45% contextual margin and render onto a 256x256 canvas
  // with high-quality bicubic smoothing. Re-encoding on this normalized canvas gives faceres
  // sharp feature gradients and aligned landmarks, avoiding centroid drift on low-res images.
  const side = Math.min(reading.box[2], reading.box[3]);
  if (side < 48 && side >= 8 && typeof document !== "undefined") {
    try {
      const w =
        input instanceof HTMLVideoElement
          ? input.videoWidth
          : (input as HTMLImageElement).naturalWidth || (input as HTMLCanvasElement).width || 0;
      const h =
        input instanceof HTMLVideoElement
          ? input.videoHeight
          : (input as HTMLImageElement).naturalHeight || (input as HTMLCanvasElement).height || 0;

      if (w > 0 && h > 0) {
        const [fx, fy, fw, fh] = reading.box;
        const padX = fw * 0.45;
        const padY = fh * 0.45;
        const cropX = Math.max(0, fx - padX);
        const cropY = Math.max(0, fy - padY);
        const cropW = Math.min(w - cropX, fw + padX * 2);
        const cropH = Math.min(h - cropY, fh + padY * 2);

        if (cropW >= 8 && cropH >= 8) {
          const targetDim = 256;
          const canvas = document.createElement("canvas");
          canvas.width = targetDim;
          canvas.height = targetDim;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(input, cropX, cropY, cropW, cropH, 0, 0, targetDim, targetDim);

            const enhanced = await human.detect(canvas, candidateScoreConfig);
            if (enhanced.face && enhanced.face.length > 0) {
              const enhancedReading = toReading(enhanced.face[0]);
              if (
                enhancedReading &&
                enhancedReading.embedding?.length === reading.embedding.length
              ) {
                return {
                  ...enhancedReading,
                  // Retain original box and boxRaw coordinates so UI reflects source dimensions
                  box: reading.box,
                  boxRaw: reading.boxRaw,
                  score: Math.max(reading.score, enhancedReading.score),
                };
              }
            }
          }
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  return reading;
}

/** Detect and encode all faces present in the input. */
export async function readAllFaces(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceReading[]> {
  const human = await loadEngine();
  const result: Result = await human.detect(input, probeConfig);
  if (!result.face || result.face.length === 0) return [];
  return result.face
    .map(toReading)
    .filter((r): r is FaceReading => r !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * Restore probe configuration on the engine after batch candidate scoring
 * so that any subsequent specimen actions immediately have multi-face
 * discovery, liveness, and anti-spoof enabled.
 */
export async function resetEngineToProbeConfig(): Promise<void> {
  const human = await loadEngine();
  human.validate(probeConfig);
}

/**
 * Quality gates for candidate scoring. Supports low-resolution web candidates (down to 10px)
 * via targeted super-resolution upscaling while protecting against non-face artifacts.
 */
export const MIN_FACE_PX = 10;
export const MIN_FACE_SCORE = 0.30;

export function passesQualityGate(r: FaceReading): { ok: boolean; reason?: string } {
  const side = Math.min(r.box[2], r.box[3]);
  if (side < MIN_FACE_PX) {
    return { ok: false, reason: `face is ${Math.round(side)}px — too small to score fairly` };
  }
  const minScore = side < 32 ? 0.25 : MIN_FACE_SCORE;
  if (r.score < minScore) {
    return { ok: false, reason: "detector was not confident enough in this face" };
  }
  return { ok: true };
}

/**
 * Flip test-time augmentation for the probe: encode the face in the frame and
 * in its mirror, then average the two descriptors. Standard practice from the
 * face-recognition literature (ArcFace and friends evaluate with flip
 * averaging) — it cancels pose asymmetry and makes the probe descriptor
 * noticeably more stable between captures. Used only for the one probe, not
 * for the two dozen candidates, where the doubled inference cost buys less.
 */
export async function readFaceStable(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceReading | null> {
  const base = await readFace(input);
  if (!base) return null;

  try {
    const w =
      input instanceof HTMLVideoElement
        ? input.videoWidth
        : (input as HTMLImageElement).naturalWidth || input.width;
    const h =
      input instanceof HTMLVideoElement
        ? input.videoHeight
        : (input as HTMLImageElement).naturalHeight || input.height;
    if (!w || !h) return base;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return base;
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(input, 0, 0, w, h);

    const mirrored = await readFace(canvas);
    if (!mirrored || mirrored.embedding.length !== base.embedding.length) return base;

    const averaged = base.embedding.map((v, i) => (v + mirrored.embedding[i]) / 2);
    return { ...base, embedding: averaged };
  } catch {
    // TTA is an improvement, never a requirement — fall back to the single pass
    return base;
  }
}

/** Decode a data URL into an image element the encoder can consume. */
export function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be decoded."));
    img.src = dataUrl;
  });
}

/**
 * Draw a video frame to a JPEG blob, scaled so it stays under SerpApi's
 * 500 KB upload ceiling.
 */
export function frameToJpeg(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  maxEdge = 900,
  quality = 0.86,
): Promise<Blob> {
  const w =
    source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLImageElement).naturalWidth || source.width;
  const h =
    source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLImageElement).naturalHeight || source.height;

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Frame could not be encoded."))),
      "image/jpeg",
      quality,
    );
  });
}
