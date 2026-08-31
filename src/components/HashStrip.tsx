"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

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
  const reduced = useReducedMotion();
  const hex = (digest ?? "").replace(/^0x/, "");
  const bytes: number[] =
    hex.length >= 64
      ? Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
      : Array.from({ length: 32 }, () => 0);

  // When one digest replaces another, snap the bars to noise for a single
  // frame before they cascade to the new byte heights — the re-settle reads
  // as "recomputed", not "redrawn".
  const prevRef = useRef<string | null>(digest);
  const [scramble, setScramble] = useState<number[] | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = digest;
    if (!digest || !prev || digest === prev || reduced) return;
    setScramble(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)));
    const id = requestAnimationFrame(() => setScramble(null));
    return () => {
      cancelAnimationFrame(id);
      setScramble(null);
    };
  }, [digest, reduced]);

  const color = {
    amber: "var(--amber)",
    verdict: "var(--verdict)",
    reject: "var(--reject)",
    dim: "var(--rule-hi)",
  }[tone];

  // Hex ends anchor the eye; the middle is what nobody actually reads.
  const head = digest?.slice(0, 10) ?? "";
  const tail = digest && digest.length > 18 ? digest.slice(-8) : "";
  const mid = digest && digest.length > 18 ? digest.slice(10, -8) : "";

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className="eyebrow">{label}</span> : null}
      <div
        className="flex items-end gap-[2px] border-b border-rule pb-px"
        style={{ height }}
        aria-hidden
      >
        {bytes.map((b, i) => {
          const v = scramble ? scramble[i] : b;
          return (
            <motion.span
              key={i}
              className="flex-1 min-w-[2px]"
              style={{ background: color }}
              initial={false}
              animate={{
                height: `${digest ? 12 + (v / 255) * 88 : 4}%`,
                opacity: digest ? 0.35 + (v / 255) * 0.65 : 0.18,
              }}
              transition={
                scramble
                  ? { duration: 0 }
                  : {
                      duration: 0.5,
                      delay: i * 0.008,
                      ease: [0.22, 1, 0.36, 1],
                    }
              }
            />
          );
        })}
      </div>
      {digest ? (
        <span className="hash">
          <span className="text-dim">{head}</span>
          <span className="text-faint">{mid}</span>
          <span className="text-dim">{tail}</span>
        </span>
      ) : (
        <span className="hash text-faint">awaiting data</span>
      )}
    </div>
  );
}
