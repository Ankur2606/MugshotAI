import "server-only";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy, sepolia } from "viem/chains";
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

export type ChainTarget = "localhost" | "sepolia" | "amoy";

export function activeTarget(): ChainTarget {
  const target = process.env.CHAIN_TARGET?.toLowerCase();
  if (target === "sepolia") return "sepolia";
  if (target === "amoy") return "amoy";
  return "localhost";
}

export function chainConfig(target: ChainTarget = activeTarget()) {
  if (target === "sepolia") {
    return {
      chain: sepolia,
      rpcUrl: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      explorer: "https://sepolia.etherscan.io",
      label: "Ethereum Sepolia",
    };
  }
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
  const override =
    target === "sepolia"
      ? process.env.SEPOLIA_REGISTRY_ADDRESS
      : target === "amoy"
        ? process.env.AMOY_REGISTRY_ADDRESS
        : undefined;
  const addr = override || record?.address;
  return addr ? (addr as Address) : null;
}

export function publicClient(target: ChainTarget = activeTarget()) {
  const { chain, rpcUrl } = chainConfig(target);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function normalizePrivateKey(raw?: string): `0x${string}` | null {
  if (!raw) return null;
  let clean = raw.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return null;
  const with0x = clean.startsWith("0x") || clean.startsWith("0X") ? clean : `0x${clean}`;
  if (/^0x[0-9a-fA-F]{64}$/.test(with0x)) {
    return with0x.toLowerCase() as `0x${string}`;
  }
  return null;
}

export function walletClient(target: ChainTarget = activeTarget()) {
  const { chain, rpcUrl } = chainConfig(target);
  const normalizedEnvKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  const key = normalizedEnvKey || (target === "localhost" ? HARDHAT_ACCOUNT_0 : null);
  if (!key) return null;
  try {
    const account = privateKeyToAccount(key);
    return createWalletClient({ account, chain, transport: http(rpcUrl) });
  } catch {
    return null;
  }
}

export function explorerTxUrl(hash: string, target: ChainTarget = activeTarget()) {
  const { explorer } = chainConfig(target);
  return explorer ? `${explorer}/tx/${hash}` : "";
}
