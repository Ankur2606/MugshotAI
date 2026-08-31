"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The signature element: similarity shown on a lens focus scale rather than a
 * progress bar. Ticks are the measurement, the amber notch is the accept
 * threshold, and the needle settles at the score. Reading "did this clear the
 * bar" takes one glance, which is the only question that matters here.
 */
export function CalibrationScale({
  valueBp,
  thresholdBp,
  state,
  pending = false,
}: {
  valueBp: number | null;
  thresholdBp: number;
  state: "accepted" | "rejected" | "pending" | "failed";
  pending?: boolean;
}) {
  const reduced = useReducedMotion();
  const pct = valueBp === null ? 0 : (valueBp / 10000) * 100;
  const needleColor =
    state === "accepted"
      ? "var(--verdict)"
      : state === "rejected"
        ? "var(--reject)"
        : "var(--dim)";

  // The arrival carries the verdict: acceptance lands with a touch of spring
  // overshoot, rejection lands heavy and overdamped — the needle itself
  // sounds like the gavel.
  const needleTransition = reduced
    ? { duration: 0 }
    : state === "accepted"
      ? { type: "spring" as const, stiffness: 260, damping: 24 }
      : state === "rejected"
        ? { type: "spring" as const, stiffness: 150, damping: 38 }
        : { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <motion.div
      className="relative select-none"
      aria-hidden
      initial={false}
      // a rejected reading dims the whole instrument: the case is closed
      animate={{ opacity: state === "rejected" ? 0.7 : 1 }}
      transition={{ duration: reduced ? 0 : 0.5, ease: "easeOut" }}
    >
      {/* tick rule */}
      <div className="relative h-6 border-t border-rule">
        {Array.from({ length: 21 }, (_, i) => {
          const major = i % 5 === 0;
          return (
            <span
              key={i}
              className="absolute top-0 w-px"
              style={{
                left: `${(i / 20) * 100}%`,
                height: major ? 9 : 5,
                background: major ? "var(--rule-hi)" : "var(--rule)",
              }}
            />
          );
        })}

        {/* accept threshold */}
        <span
          className="absolute top-0 w-px"
          style={{
            left: `${(thresholdBp / 10000) * 100}%`,
            height: 22,
            background: "var(--amber)",
            opacity: 0.75,
          }}
        />
        <span
          className="absolute font-mono text-[9px] tracking-widest"
          style={{
            left: `${(thresholdBp / 10000) * 100}%`,
            top: 12,
            color: "var(--amber-deep)",
            transform: "translateX(-50%)",
          }}
        >
          {(thresholdBp / 100).toFixed(0)}
        </span>

        {/* needle */}
        {valueBp !== null && (
          <motion.span
            className="absolute -top-1 w-[2px]"
            style={{ height: 18, background: needleColor }}
            initial={{ left: "0%", opacity: 0 }}
            animate={{ left: `${pct}%`, opacity: 1 }}
            transition={needleTransition}
          />
        )}

        {/* acceptance flash: a verdict-colored tick at the landing point */}
        {state === "accepted" && valueBp !== null && !reduced && (
          <motion.span
            key={valueBp}
            className="absolute -top-1 w-px"
            style={{ left: `${pct}%`, height: 18, background: "var(--verdict)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
          />
        )}

        {/* scanning sweep while the candidate is still being encoded */}
        {pending && (
          <motion.span
            className="absolute -top-1 w-[2px]"
            style={{ height: 18, background: "var(--amber)", opacity: 0.5 }}
            animate={{ left: ["0%", "100%", "0%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>
    </motion.div>
  );
}
