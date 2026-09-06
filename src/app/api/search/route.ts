import { NextResponse } from "next/server";
import { activeProvider } from "@/lib/providers";
import { sha256Bytes } from "@/lib/canonical";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Runs the probe image through the configured search backend and returns the
 * candidate pages it found. No scoring happens here — the client re-encodes
 * each candidate face and decides.
 */
export async function POST(req: Request) {
  const provider = activeProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "No search backend configured. Set SERPAPI_API_KEY in .env.local, then restart the dev server.",
      },
      { status: 503 },
    );
  }
  if (!provider.configured()) {
    return NextResponse.json(
      { error: `${provider.label} is selected but its credentials are missing.` },
      { status: 503 },
    );
  }

  let bytes: Uint8Array;
  let mime: string;
  let probes: Array<{ id: string; label: string; box?: [number, number, number, number] }> | undefined = undefined;

  try {
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Send the probe as multipart field 'image'." }, { status: 400 });
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    mime = file.type || "image/jpeg";

    const probesRaw = form.get("probes");
    if (typeof probesRaw === "string") {
      try {
        const parsed = JSON.parse(probesRaw);
        if (Array.isArray(parsed)) {
          probes = parsed;
        }
      } catch {}
    } else {
      const boxRaw = form.get("faceBox");
      if (typeof boxRaw === "string") {
        try {
          const parsedBox = JSON.parse(boxRaw);
          if (Array.isArray(parsedBox) && parsedBox.length === 4) {
            probes = [{ id: "face_0", label: "Face Target", box: parsedBox as [number, number, number, number] }];
          }
        } catch {}
      }
    }
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded probe image." }, { status: 400 });
  }

  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "The probe image was empty." }, { status: 400 });
  }

  try {
    const started = Date.now();
    const outcome = await provider.search(bytes, mime, probes);
    return NextResponse.json({
      provider: outcome.provider,
      providerLabel: provider.label,
      queryRef: outcome.queryRef ?? null,
      probeImageSha256: sha256Bytes(bytes),
      elapsedMs: Date.now() - started,
      candidates: outcome.candidates.slice(0, 28),
      totalFound: outcome.candidates.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
