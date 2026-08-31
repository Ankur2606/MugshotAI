"use client";

import { useId } from "react";
import { motion } from "motion/react";

/**
 * The accept threshold as a calibration ruler rather than a stock slider: the
 * same tick vocabulary as the candidates' scales, an amber needle you drag,
 * and the two measured reference points from /selftest marked on the track —
 * the highest different-person score and the lowest same-person score. The
 * operator is not picking a number in the void; they are placing a needle
 * inside a measured gap.
 *
 * A native range input does the interaction (drag, keys, screen reader), laid
 * transparently over the drawing.
 */

const MIN = 2000;
const MAX = 9000;

// measured on the bundled encoder, see /selftest
const BEST_DIFFERENT = 4488;
const WORST_SAME = 5771;

const pct = (bp: number) => ((bp - MIN) / (MAX - MIN)) * 100;

export function ThresholdDial({
  valueBp,
  onChange,
}: {
  valueBp: number;
  onChange: (bp: number) => void;
}) {
  const id = useId();

  return (
    <div className="w-full max-w-[280px] select-none">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="eyebrow cursor-pointer">
          accept at
        </label>
        <span className="font-mono text-[13px] tabular-nums text-amber">
          {(valueBp / 100).toFixed(1)}
        </span>
      </div>

      <div className="relative mt-2 h-9">
        {/* tick rule */}
        <div className="absolute inset-x-0 top-3 border-t border-rule">
          {Array.from({ length: 15 }, (_, i) => {
            const major = i % 7 === 0;
            return (
              <span
                key={i}
                className="absolute top-0 w-px"
                style={{
                  left: `${(i / 14) * 100}%`,
                  height: major ? 8 : 4,
                  background: major ? "var(--rule-hi)" : "var(--rule)",
                }}
              />
            );
          })}

          {/* the measured gap: everything between these marks is defensible */}
          <span
            className="absolute top-0 h-[3px]"
            style={{
              left: `${pct(BEST_DIFFERENT)}%`,
              width: `${pct(WORST_SAME) - pct(BEST_DIFFERENT)}%`,
              background: "var(--rule-hi)",
              opacity: 0.55,
            }}
          />
          <span
            className="absolute top-0 w-px"
            style={{ left: `${pct(BEST_DIFFERENT)}%`, height: 10, background: "var(--reject)", opacity: 0.7 }}
            title="highest different-person score measured"
          />
          <span
            className="absolute top-0 w-px"
            style={{ left: `${pct(WORST_SAME)}%`, height: 10, background: "var(--verdict)", opacity: 0.7 }}
            title="lowest same-person score measured"
          />

          {/* needle */}
          <motion.span
            className="absolute -top-1.5 w-[2px]"
            style={{ height: 16, background: "var(--amber)", left: `${pct(valueBp)}%` }}
            layout
            transition={{ type: "spring", stiffness: 700, damping: 40 }}
          />
        </div>

        {/* interaction layer */}
        <input
          id={id}
          type="range"
          min={MIN}
          max={MAX}
          step={100}
          value={valueBp}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 top-0 h-9 w-full cursor-ew-resize opacity-0"
          aria-label="Accept threshold"
          aria-valuetext={`${(valueBp / 100).toFixed(1)} of 100`}
        />
      </div>

      <div className="flex justify-between font-mono text-[9px] tracking-widest text-faint">
        <span>{MIN / 100}</span>
        <span className="text-reject">{(BEST_DIFFERENT / 100).toFixed(0)} diff</span>
        <span className="text-verdict">{(WORST_SAME / 100).toFixed(0)} same</span>
        <span>{MAX / 100}</span>
      </div>
    </div>
  );
}
