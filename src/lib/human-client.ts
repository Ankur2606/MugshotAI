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
    announce("loading models");
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
    detector: { rotation: true, maxDetected: 1, minConfidence: 0.35, return: false },
    mesh: { enabled: true },
    iris: { enabled: false },
    description: { enabled: true },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
  },
};

/**
 * Target face width fed to the encoder when rescuing a small candidate.
 * faceres wants roughly this much face to produce a stable descriptor; the
 * exact figure is a tuning knob, not a law — raise it if small-face recall
 * is still weak, lower it if upscaling starts inventing detail.
 */
const RESCUE_FACE_PX = 160;
/** Never blow a thumbnail up by more than this; past it we are inventing pixels. */
const MAX_RESCUE_SCALE = 8;

function sourceSize(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): { w: number; h: number } {
  if (input instanceof HTMLVideoElement) {
    return { w: input.videoWidth, h: input.videoHeight };
  }
  const el = input as HTMLImageElement;
  return { w: el.naturalWidth || el.width, h: el.naturalHeight || el.height };
}

/**
 * Re-run detection on an upscaled copy of the whole image.
 *
 * Search engines index tiny thumbnails, and Google Lens will happily rank a
 * 16px face first. Our detector can find that face but the encoder reads it
 * as mush, so the descriptor is unusable and the right answer looks like a
 * miss. Scaling the image so the face lands near RESCUE_FACE_PX adds no
 * information, but it does put the face in the size range the encoder was
 * trained on, which is where the recall actually comes back.
 *
 * The scale is derived from the measured face box, so nothing here is tied
 * to a particular image size.
 */
async function rescueSmallFace(
  human: Human,
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  firstPass: FaceResult,
): Promise<FaceReading | null> {
  const { w, h } = sourceSize(input);
  if (!w || !h) return null;

  const box = firstPass.box as [number, number, number, number] | undefined;
  const faceSide = box ? Math.min(box[2], box[3]) : 0;
  if (!faceSide) return null;

  const scale = Math.min(MAX_RESCUE_SCALE, RESCUE_FACE_PX / faceSide);
  if (scale <= 1.05) return null; // already big enough to be worth it

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Smooth interpolation beats nearest-neighbour here: the encoder is far more
  // upset by block edges than by softness.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height);

  const result: Result = await human.detect(canvas, candidateScoreConfig);
  if (!result.face || result.face.length === 0) return null;

  const reading = toReading(result.face[0]);
  if (!reading) return null;

  // Report the box in ORIGINAL image coordinates so downstream size checks and
  // overlays stay honest about how small the face really was.
  return {
    ...reading,
    box: [
      reading.box[0] / scale,
      reading.box[1] / scale,
      reading.box[2] / scale,
      reading.box[3] / scale,
    ],
    mesh: reading.mesh.map((p) => [p[0] / scale, p[1] / scale] as [number, number]),
  };
}

export async function scoreCandidateFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceReading | null> {
  const human = await loadEngine();
  const result: Result = await human.detect(input, candidateScoreConfig);
  if (!result.face || result.face.length === 0) return null;

  const first = result.face[0];
  const box = first.box as [number, number, number, number] | undefined;
  const side = box ? Math.min(box[2], box[3]) : 0;

  // A face big enough to encode well needs no help.
  if (side >= MIN_FACE_PX) return toReading(first);

  try {
    const rescued = await rescueSmallFace(human, input, first);
    if (rescued) return rescued;
  } catch {
    // Rescue is an improvement, never a requirement.
  }
  return toReading(first);
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
 * Quality gates for candidate scoring.
 *
 * Cosine similarity on face embeddings degrades below ~48px of face: small
 * crops drift toward the mean face. The gate exists so a weak descriptor is
 * not presented with the same authority as a strong one.
 *
 * It deliberately does NOT decide visibility. A thumbnail that the search
 * engine ranked first is evidence even when our encoder reads it poorly —
 * dropping it means the operator never sees the answer the indexer already
 * found. So a small face is scored and marked low-confidence, not discarded.
 */
export const MIN_FACE_PX = 48;
export const MIN_FACE_SCORE = 0.45;

/** Below this the descriptor is noise rather than merely weak. */
export const FLOOR_FACE_PX = 12;

export type FaceConfidence = "full" | "low";

export function passesQualityGate(
  r: FaceReading,
): { ok: boolean; confidence: FaceConfidence; reason?: string } {
  const side = Math.min(r.box[2], r.box[3]);
  if (side < FLOOR_FACE_PX) {
    return {
      ok: false,
      confidence: "low",
      reason: `face is ${Math.round(side)}px — below the ${FLOOR_FACE_PX}px floor for any descriptor`,
    };
  }
  if (side < MIN_FACE_PX) {
    return {
      ok: true,
      confidence: "low",
      reason: `face is ${Math.round(side)}px — scored from an upscaled crop, treat as a lead not a match`,
    };
  }
  if (r.score < MIN_FACE_SCORE) {
    return {
      ok: true,
      confidence: "low",
      reason: "detector was not confident in this face — treat as a lead not a match",
    };
  }
  return { ok: true, confidence: "full" };
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
