import { keccak256, toHex, sha256 } from "viem";

/**
 * The evidence bundle is the off-chain document whose digest goes on chain.
 * Every field is a string or an integer. There are deliberately no floating
 * point numbers: a float that round-trips through JSON on a different runtime
 * can serialize differently and silently break re-verification.
 */
export type EvidenceBundle = {
  /** bundle schema version */
  v: 1;
  /** sha256 of the probe image bytes */
  probeImageSha256: string;
  /** sha256 of the quantized probe face descriptor */
  probeDescriptorSha256: string;
  /** URL of the matched post */
  matchUrl: string;
  /** host the match came from, e.g. "instagram.com" */
  matchSource: string;
  /** page title reported by the search provider */
  matchTitle: string;
  /** sha256 of the matched image bytes as fetched */
  matchImageSha256: string;
  /** face similarity in basis points, 0..10000 */
  similarityBp: number;
  /** which encoder produced both descriptors */
  encoder: string;
  /** which search backend found the match */
  provider: string;
  /** unix seconds, when the probe was captured */
  capturedAt: number;
};

/**
 * Deterministic JSON: object keys sorted at every depth, no insignificant
 * whitespace. Two runtimes given the same bundle must produce byte-identical
 * output, otherwise the on-chain digest is not reproducible.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** keccak256 of the canonical serialization. This is what gets anchored. */
export function bundleDigest(bundle: EvidenceBundle): `0x${string}` {
  return keccak256(toHex(canonicalJson(bundle)));
}

/** sha256 of raw bytes, as a 0x-prefixed hex string. */
export function sha256Bytes(bytes: Uint8Array): `0x${string}` {
  return sha256(toHex(bytes));
}

/**
 * Quantize a float descriptor to fixed-point integers before hashing, so the
 * descriptor digest is stable across runs and platforms.
 */
export function descriptorDigest(descriptor: number[]): `0x${string}` {
  const quantized = descriptor.map((n) => Math.round(n * 10000));
  return sha256(toHex(quantized.join(",")));
}

/** Cosine similarity, clamped to [0,1] and returned in basis points. */
export function cosineSimilarityBp(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(10000, Math.round(cos * 10000)));
}
