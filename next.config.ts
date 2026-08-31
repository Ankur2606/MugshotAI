import type { NextConfig } from "next";

/**
 * @vladmandic/human ships a malformed export map: its subpath keys are missing
 * the leading "./", so none of them resolve, and the bare specifier falls
 * through to the "node" condition — the Node build, which requires
 * @tensorflow/tfjs-node. We only ever run Human in the browser, so point the
 * specifier straight at the browser ESM bundle.
 */
const HUMAN_BROWSER_BUILD = "./node_modules/@vladmandic/human/dist/human.esm.js";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@vladmandic/human": HUMAN_BROWSER_BUILD,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@vladmandic/human$": require("path").resolve(
        process.cwd(),
        "node_modules/@vladmandic/human/dist/human.esm.js",
      ),
    };
    return config;
  },
};

export default nextConfig;
