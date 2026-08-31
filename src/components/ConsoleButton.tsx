"use client";

import { forwardRef } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The console's one button, in three registers. Hover develops the label the
 * way an exposure develops paper: a fill sweeps in from the left edge and the
 * text flips to ink. Press compresses 2% on a spring. Everything else about
 * it stays quiet — hairlines, mono uppercase, no radius.
 *
 *  primary — amber fill, for the one action a station is waiting on
 *  quiet   — hairline that fills bone on hover, for secondary actions
 *  ghost   — text only, for tertiary actions like discard
 */

type Variant = "primary" | "quiet" | "ghost";

const COLORS: Record<Variant, { edge: string; text: string; fill: string; fillText: string }> = {
  primary: { edge: "var(--amber)", text: "var(--amber)", fill: "var(--amber)", fillText: "var(--ink)" },
  quiet: { edge: "var(--rule-hi)", text: "var(--dim)", fill: "var(--bone)", fillText: "var(--ink)" },
  ghost: { edge: "transparent", text: "var(--dim)", fill: "transparent", fillText: "var(--bone)" },
};

export const ConsoleButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    /** primary buttons can render pre-filled while busy, e.g. "Tracing…" */
    filled?: boolean;
  }
>(function ConsoleButton({ variant = "quiet", filled = false, className = "", children, disabled, ...rest }, ref) {
  const reduced = useReducedMotion();
  const c = COLORS[variant];

  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      initial={false}
      whileHover={disabled || reduced ? undefined : "hover"}
      whileTap={disabled || reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`group relative overflow-hidden px-4 py-2 font-mono text-[11px] uppercase tracking-widest outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber disabled:cursor-not-allowed ${className}`}
      style={{
        border: `1px solid ${disabled ? "var(--rule)" : c.edge}`,
        color: disabled ? "var(--faint)" : filled ? c.fillText : c.text,
        background: filled && !disabled ? c.fill : "transparent",
      }}
      {...(rest as object)}
    >
      {/* the exposure: sweeps in from the left on hover */}
      {!filled && !disabled && variant !== "ghost" && (
        <motion.span
          aria-hidden
          className="absolute inset-0"
          style={{ background: c.fill, transformOrigin: "0% 50%" }}
          variants={{ hover: { scaleX: 1 } }}
          initial={{ scaleX: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      <motion.span
        className="relative z-10 inline-block"
        variants={
          variant === "ghost"
            ? { hover: { color: c.fillText, x: 2 } }
            : { hover: { color: c.fillText } }
        }
        transition={{ duration: 0.22 }}
      >
        {children}
      </motion.span>
    </motion.button>
  );
});
