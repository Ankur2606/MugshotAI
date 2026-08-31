"use client";

import { motion } from "motion/react";

/**
 * One band of the docket. The spine on the left is the chain of custody: it
 * fills downward as each station completes, so the page reads as a single
 * form being filled in rather than four disconnected panels. The roman
 * numerals are load-bearing — these stations are strictly ordered.
 */
export function Station({
  index,
  title,
  caption,
  active,
  done,
  last,
  children,
}: {
  index: string;
  title: string;
  caption: string;
  active: boolean;
  done: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="grid grid-cols-[28px_1fr] gap-x-5 sm:grid-cols-[52px_1fr] sm:gap-x-8"
      aria-current={active && !done ? "step" : undefined}
    >
      {/* spine */}
      <div className="relative flex flex-col items-center pt-9">
        <motion.span
          className="h-2 w-2 rounded-full"
          initial={false}
          animate={{
            background: done
              ? "var(--verdict)"
              : active
                ? "var(--amber)"
                : "var(--rule-hi)",
            scale: active && !done ? [1, 1.35, 1] : 1,
          }}
          transition={{
            background: { duration: 0.4 },
            scale: { duration: 2, repeat: active && !done ? Infinity : 0, ease: "easeInOut" },
          }}
        />
        {!last && (
          <div className="relative mt-2 w-px flex-1 bg-rule">
            <motion.div
              className="absolute inset-x-0 top-0 bg-verdict"
              initial={{ height: "0%" }}
              animate={{ height: done ? "100%" : "0%" }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        )}
      </div>

      {/* body */}
      <motion.div
        className="border-b border-rule py-8 last:border-b-0 sm:py-10"
        initial={false}
        animate={{ opacity: active ? 1 : 0.42, y: active ? 0 : 4 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[11px] tracking-[0.2em] text-faint">{index}</span>
          <h2 className="font-display text-[30px] leading-none tracking-[-0.01em] sm:text-[36px]">
            {title}
          </h2>
        </div>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-dim">{caption}</p>
        <div className="mt-8">{children}</div>
      </motion.div>
    </section>
  );
}
