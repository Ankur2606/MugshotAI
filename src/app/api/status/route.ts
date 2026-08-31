import { NextResponse } from "next/server";
import { providerStatus, activeProvider } from "@/lib/providers";
import { activeTarget, chainConfig, publicClient, registryAddress } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether each half of the pipeline is actually wired up right now. */
export async function GET() {
  const target = activeTarget();
  const { label, chain, rpcUrl, explorer } = chainConfig(target);
  const address = registryAddress(target);

  let chainReachable = false;
  let blockNumber: string | null = null;
  let chainError: string | null = null;
  try {
    blockNumber = (await publicClient(target).getBlockNumber()).toString();
    chainReachable = true;
  } catch (e) {
    chainError = e instanceof Error ? e.message.split("\n")[0] : "RPC unreachable";
  }

  const active = activeProvider();

  return NextResponse.json({
    search: {
      providers: providerStatus(),
      active: active ? { id: active.id, label: active.label, configured: active.configured() } : null,
    },
    chain: {
      target,
      label,
      chainId: chain.id,
      rpcUrl,
      explorer,
      registry: address,
      reachable: chainReachable,
      blockNumber,
      error: chainError,
    },
  });
}
