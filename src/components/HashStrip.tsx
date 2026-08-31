"use client";

import { motion } from "motion/react";

/**
 * The 32 bytes of a digest, drawn as 32 bars whose height is the byte value.
 * It is a fingerprint you can compare at a glance: when a sealed bundle is
 * altered, the strip visibly scatters instead of matching. That is the whole
 * "tamper-evident" idea made legible without reading hex.
 */
export function HashStrip({
  digest,
  tone = "amber",
  height = 34,
  label,
}: {
  digest: string | null;
  tone?: "amber" | "verdict" | "reject" | "dim";
  height?: number;
  label?: string;
}) {
  const hex = (digest ?? "").replace(/^0x/, "");
  const bytes: number[] =
    hex.length >= 64
      ? Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
      : Array.from({ length: 32 }, () => 0);

  const color = {
    amber: "var(--amber)",
    verdict: "var(--verdict)",
    reject: "var(--reject)",
    dim: "var(--rule-hi)",
  }[tone];

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className="eyebrow">{label}</span> : null}
      <div
        className="flex items-end gap-[2px] border-b border-rule pb-px"
        style={{ height }}
        aria-hidden
      >
        {bytes.map((b, i) => (
          <motion.span
            key={i}
            className="flex-1 min-w-[2px]"
            style={{ background: color }}
            initial={false}
            animate={{
              height: `${digest ? 12 + (b / 255) * 88 : 4}%`,
              opacity: digest ? 0.35 + (b / 255) * 0.65 : 0.18,
            }}
            transition={{
              duration: 0.5,
              delay: i * 0.008,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        ))}
      </div>
      <span className="hash text-faint">{digest ?? "awaiting data"}</span>
    </div>
  );
}
