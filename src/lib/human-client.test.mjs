/**
 * Small-face rescue + quality-gate contract.
 * Run: node src/lib/human-client.test.mjs
 *
 * human-client.ts is browser-only (canvas, WebGL), so the DOM-dependent paths
 * cannot be imported here. What IS worth pinning is the arithmetic that decides
 * whether a tiny thumbnail gets rescued and by how much — that is where the
 * small-face recall bug lived. The constants below mirror the module; if you
 * change them there, change them here and this check tells you what it costs.
 */
import assert from "node:assert/strict";

const MIN_FACE_PX = 48;
const FLOOR_FACE_PX = 12;
const RESCUE_FACE_PX = 160;
const MAX_RESCUE_SCALE = 8;

const rescueScale = (faceSide) => Math.min(MAX_RESCUE_SCALE, RESCUE_FACE_PX / faceSide);
const willRescue = (faceSide) => faceSide < MIN_FACE_PX && rescueScale(faceSide) > 1.05;

function gate(faceSide, detScore = 0.9) {
  if (faceSide < FLOOR_FACE_PX) return { ok: false, confidence: "low" };
  if (faceSide < MIN_FACE_PX) return { ok: true, confidence: "low" };
  if (detScore < 0.45) return { ok: true, confidence: "low" };
  return { ok: true, confidence: "full" };
}

// The reported bug: Google Lens ranked a ~16px face first, our pipeline binned it.
assert.equal(willRescue(16), true, "16px face must be rescued, not discarded");
assert.equal(gate(16).ok, true, "16px face must still be scored");
assert.equal(gate(16).confidence, "low", "16px face must be flagged low-confidence");

// Upscaling is capped so we never invent detail out of nothing.
assert.equal(rescueScale(16), 8, "16px -> capped at 8x, not 10x");
assert.equal(rescueScale(40), 4, "40px -> 4x to reach 160px");
assert.ok(rescueScale(4) <= MAX_RESCUE_SCALE, "cap holds at the extreme");

// Below the floor a descriptor is noise, not weak evidence.
assert.equal(gate(8).ok, false, "sub-floor face is refused outright");

// Faces already big enough are left alone — no needless re-encode.
assert.equal(willRescue(48), false, "48px face needs no rescue");
assert.equal(willRescue(200), false, "large face needs no rescue");
assert.equal(gate(200).confidence, "full", "large clear face is full confidence");

// A big face the detector is unsure about is still only a lead.
assert.equal(gate(200, 0.2).confidence, "low", "low detector score downgrades confidence");

console.log("human-client small-face rescue checks: OK");
