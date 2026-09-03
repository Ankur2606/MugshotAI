import { NextResponse } from "next/server";
import {
  REGISTRY_ABI,
  activeTarget,
  chainConfig,
  explorerTxUrl,
  publicClient,
  registryAddress,
  walletClient,
} from "@/lib/chain";
import { bundleDigest, canonicalJson, type EvidenceBundle } from "@/lib/canonical";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Hashes the evidence bundle and writes that digest to the registry contract.
 * The bundle itself never leaves the browser's control — only its keccak256
 * digest, the similarity score, and the matched URL go on chain.
 */
export async function POST(req: Request) {
  const target = activeTarget();
  const address = registryAddress(target);
  const { label } = chainConfig(target);

  if (!address) {
    return NextResponse.json(
      {
        error: `No EvidenceRegistry deployed on ${label}. Run "npm run chain:deploy" first.`,
      },
      { status: 503 },
    );
  }

  const wallet = walletClient(target);
  if (!wallet) {
    return NextResponse.json(
      {
        error: `No valid signing key for ${label}. Set DEPLOYER_PRIVATE_KEY (64-character private key) in .env.local.`,
      },
      { status: 503 },
    );
  }

  let bundle: EvidenceBundle;
  try {
    bundle = (await req.json()).bundle as EvidenceBundle;
    if (!bundle || typeof bundle !== "object") throw new Error();
  } catch {
    return NextResponse.json({ error: "Send the evidence bundle as { bundle: {...} }." }, { status: 400 });
  }

  const digest = bundleDigest(bundle);
  const client = publicClient(target);

  try {
    // Refuse early with a clear message rather than letting the revert surface.
    const [exists] = (await client.readContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "verify",
      args: [digest],
    })) as [boolean, bigint, string, number];

    if (exists) {
      return NextResponse.json(
        {
          error: "This exact bundle is already anchored. Re-run the scan to produce a new one.",
          digest,
          alreadyAnchored: true,
        },
        { status: 409 },
      );
    }

    const hash = await wallet.writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "anchor",
      args: [digest, bundle.similarityBp, bundle.matchUrl],
      chain: wallet.chain,
      account: wallet.account,
    });

    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });

    return NextResponse.json({
      digest,
      txHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
      contract: address,
      network: label,
      chainId: chainConfig(target).chain.id,
      explorerUrl: explorerTxUrl(hash, target),
      canonical: canonicalJson(bundle),
      anchoredAt: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anchoring failed.";
    const hint = message.includes("fetch") || message.includes("ECONNREFUSED")
      ? ` Is the chain reachable at ${chainConfig(target).rpcUrl}?`
      : "";
    return NextResponse.json({ error: message.split("\n")[0] + hint }, { status: 502 });
  }
}
