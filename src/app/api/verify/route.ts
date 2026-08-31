import { NextResponse } from "next/server";
import {
  REGISTRY_ABI,
  activeTarget,
  chainConfig,
  publicClient,
  registryAddress,
} from "@/lib/chain";
import { bundleDigest, canonicalJson, type EvidenceBundle } from "@/lib/canonical";

export const runtime = "nodejs";

/**
 * Re-derives the digest from a bundle handed back to us and asks the chain
 * whether it was ever anchored. Any edit to the bundle changes the digest, so
 * a tampered bundle simply will not be found.
 */
export async function POST(req: Request) {
  const target = activeTarget();
  const address = registryAddress(target);
  const { label, chain } = chainConfig(target);

  if (!address) {
    return NextResponse.json(
      { error: `No EvidenceRegistry deployed on ${label}. Run "npm run chain:deploy" first.` },
      { status: 503 },
    );
  }

  let bundle: EvidenceBundle;
  try {
    bundle = (await req.json()).bundle as EvidenceBundle;
    if (!bundle || typeof bundle !== "object") throw new Error();
  } catch {
    return NextResponse.json({ error: "Send the bundle to check as { bundle: {...} }." }, { status: 400 });
  }

  const digest = bundleDigest(bundle);

  try {
    const [exists, timestamp, submitter, similarityBp] = (await publicClient(target).readContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "verify",
      args: [digest],
    })) as [boolean, bigint, string, number];

    return NextResponse.json({
      digest,
      recomputedFrom: canonicalJson(bundle),
      onChain: exists,
      timestamp: exists ? Number(timestamp) : null,
      submitter: exists ? submitter : null,
      similarityBp: exists ? Number(similarityBp) : null,
      contract: address,
      network: label,
      chainId: chain.id,
      verdict: exists
        ? "Digest found on chain. The bundle is byte-for-byte what was sealed."
        : "No such digest on chain. This bundle was never sealed, or it has been altered since.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Verification call failed.";
    return NextResponse.json({ error: message.split("\n")[0] }, { status: 502 });
  }
}
