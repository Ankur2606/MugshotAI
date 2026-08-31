import "server-only";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";
import registry from "./contract/EvidenceRegistry.json";
import deployments from "./contract/deployments.json";

export const REGISTRY_ABI = registry.abi;

/** Well-known first account of a default `hardhat node`. Local dev only. */
const HARDHAT_ACCOUNT_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export type ChainTarget = "localhost" | "amoy";

export function activeTarget(): ChainTarget {
  return process.env.CHAIN_TARGET === "amoy" ? "amoy" : "localhost";
}

export function chainConfig(target: ChainTarget = activeTarget()) {
  if (target === "amoy") {
    return {
      chain: polygonAmoy,
      rpcUrl: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      explorer: "https://amoy.polygonscan.com",
      label: "Polygon Amoy",
    };
  }
  return {
    chain: hardhatLocal,
    rpcUrl: "http://127.0.0.1:8545",
    explorer: "",
    label: "Hardhat Local",
  };
}

export function registryAddress(target: ChainTarget = activeTarget()): Address | null {
  const record = (deployments as Record<string, { address: string } | undefined>)[target];
  const override = target === "amoy" ? process.env.AMOY_REGISTRY_ADDRESS : undefined;
  const addr = override || record?.address;
  return addr ? (addr as Address) : null;
}

export function publicClient(target: ChainTarget = activeTarget()) {
  const { chain, rpcUrl } = chainConfig(target);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function walletClient(target: ChainTarget = activeTarget()) {
  const { chain, rpcUrl } = chainConfig(target);
  const key = process.env.DEPLOYER_PRIVATE_KEY || (target === "localhost" ? HARDHAT_ACCOUNT_0 : "");
  if (!key) return null;
  const account = privateKeyToAccount(key as `0x${string}`);
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

export function explorerTxUrl(hash: string, target: ChainTarget = activeTarget()) {
  const { explorer } = chainConfig(target);
  return explorer ? `${explorer}/tx/${hash}` : "";
}
