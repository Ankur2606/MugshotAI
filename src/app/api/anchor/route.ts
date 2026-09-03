import { NextResponse } from "next/server";
import { parseAbiItem } from "viem";
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
  const { label, explorer } = chainConfig(target);

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
    const [exists, timestamp, submitter, similarityBp] = (await client.readContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "verify",
      args: [digest],
    })) as [boolean, bigint, string, number];

    if (exists) {
      let txHash: string | null = null;
      let blockNumber: string | null = null;
      try {
        const latestBlock = await client.getBlockNumber();
        const fromBlock = latestBlock > BigInt(50000) ? latestBlock - BigInt(49999) : BigInt(0);
        const logs = await client.getLogs({
          address,
          event: parseAbiItem(
            "event Anchored(bytes32 indexed bundleHash, address indexed submitter, uint64 timestamp, uint32 similarityBp, string matchUrl)"
          ),
          args: {
            bundleHash: digest,
          },
          fromBlock,
        });
        if (logs.length > 0) {
          const matchLog = logs[logs.length - 1];
          txHash = matchLog.transactionHash;
          blockNumber = matchLog.blockNumber ? matchLog.blockNumber.toString() : null;
        }
      } catch (err) {
        console.warn("Could not query historical Anchored logs:", err);
      }

      const explorerUrl = txHash
        ? explorerTxUrl(txHash, target)
        : explorer
          ? `${explorer}/address/${address}`
          : "";

      return NextResponse.json(
        {
          error: "This exact bundle is already anchored. Re-run the scan to produce a new one.",
          digest,
          alreadyAnchored: true,
          existingRecord: {
            digest,
            txHash,
            blockNumber,
            timestamp: Number(timestamp),
            submitter,
            similarityBp: Number(similarityBp),
            contract: address,
            network: label,
            chainId: chainConfig(target).chain.id,
            explorerUrl,
          },
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
