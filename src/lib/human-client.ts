"use client";

import type { Human, Config, Result, FaceResult } from "@vladmandic/human";

/**
 * One Human instance for the whole session, loaded lazily in the browser.
 * The probe face and every candidate face go through this same instance, so
 * their descriptors come from the identical encoder and the similarity number
 * actually means something.
 */

export const ENCODER_ID = "human/blazeface+facemesh+faceres";

const config: Partial<Config> = {
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
    const human = new HumanCtor(config);
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
  const result: Result = await human.detect(input);
  if (!result.face || result.face.length === 0) return null;
  const best = [...result.face].sort((a, b) => (b.faceScore ?? 0) - (a.faceScore ?? 0))[0];
  return toReading(best);
}

/** Detect and encode all faces present in the input. */
export async function readAllFaces(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceReading[]> {
  const human = await loadEngine();
  const result: Result = await human.detect(input);
  if (!result.face || result.face.length === 0) return [];
  return result.face
    .map(toReading)
    .filter((r): r is FaceReading => r !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * Quality gates for candidate scoring. Cosine similarity on face embeddings
 * degrades sharply below ~50px of face — low-resolution crops drift toward
 * the mean face and inflate false matches — so a candidate face smaller than
 * this, or one the detector itself is unsure about, is refused a score
 * rather than given a misleading one.
 */
export const MIN_FACE_PX = 48;
export const MIN_FACE_SCORE = 0.45;

export function passesQualityGate(r: FaceReading): { ok: boolean; reason?: string } {
  const side = Math.min(r.box[2], r.box[3]);
  if (side < MIN_FACE_PX) {
    return { ok: false, reason: `face is ${Math.round(side)}px — too small to score fairly` };
  }
  if (r.score < MIN_FACE_SCORE) {
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
