"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { loadEngine } from "@/lib/human-client";

/**
 * The gate. Two panels hold the console shut while the face engine actually
 * loads — the progress shown is the real model pipeline, not a timer — and
 * part like vault doors when it reports ready. If the engine stalls or fails
 * the gate opens anyway after a hard cap, since the console can explain the
 * problem better than a stuck door.
 */

const STAGES: Record<string, number> = {
  "loading runtime": 0.18,
  "loading models": 0.52,
  "warming up": 0.86,
  ready: 1,
};

const MIN_SHOW_MS = 1700;
const HARD_CAP_MS = 12000;

const EASE_GATE = [0.76, 0, 0.18, 1] as const;

export function GateIntro({ onDone }: { onDone?: () => void }) {
  const reduced = useReducedMotion();
  const [stage, setStage] = useState("loading runtime");
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const started = Date.now();
    let alive = true;

    // ?gate=5000 holds the doors for at least that many ms — handy when
    // recording the intro, since a warm cache can open them in under two
    // seconds.
    let minShow = MIN_SHOW_MS;
    const param = new URLSearchParams(window.location.search).get("gate");
    if (param && Number.isFinite(Number(param))) {
      minShow = Math.min(30000, Math.max(0, Number(param)));
    }

    const finish = () => {
      if (!alive) return;
      const wait = Math.max(0, minShow - (Date.now() - started));
      setTimeout(() => alive && setOpen(true), wait);
    };

    loadEngine((s) => alive && setStage(s))
      .then(finish)
      .catch(() => {
        if (alive) setStage("engine failed — opening anyway");
        finish();
      });

    const cap = setTimeout(finish, Math.max(HARD_CAP_MS, minShow));
    return () => {
      alive = false;
      clearTimeout(cap);
    };
  }, []);

  useEffect(() => {
    if (gone) onDone?.();
  }, [gone, onDone]);

  const progress = STAGES[stage] ?? (open ? 1 : 0.94);
  const duration = reduced ? 0 : 1.05;

  return (
    <AnimatePresence>
      {!gone && (
        <motion.div
          className="fixed inset-0 z-50"
          aria-hidden={open}
          initial={false}
          exit={{ opacity: 0 }}
          // a breath on the way out — the hard cut read as a glitch
          transition={{ duration: 0.25 }}
        >
          {/* left leaf */}
          <motion.div
            className="absolute inset-y-0 left-0 w-1/2"
            style={{ background: "var(--ink)", willChange: "transform" }}
            initial={false}
            animate={{ x: open ? "-100%" : "0%" }}
            transition={{ duration, ease: EASE_GATE }}
            onAnimationComplete={() => open && setGone(true)}
          >
            <div
              className="absolute inset-y-0 right-0 w-px"
              style={{ background: "var(--rule-hi)" }}
            />
            {/* film-edge ticks along the seam */}
            <div className="absolute inset-y-0 right-2 hidden flex-col justify-between py-6 sm:flex">
              {Array.from({ length: 24 }, (_, i) => (
                <span
                  key={i}
                  className="block h-px"
                  style={{
                    width: i % 6 === 0 ? 14 : 7,
                    marginLeft: "auto",
                    background: i % 6 === 0 ? "var(--rule-hi)" : "var(--rule)",
                  }}
                />
              ))}
            </div>
          </motion.div>

          {/* right leaf */}
          <motion.div
            className="absolute inset-y-0 right-0 w-1/2"
            style={{ background: "var(--ink)", willChange: "transform" }}
            initial={false}
            animate={{ x: open ? "100%" : "0%" }}
            transition={{ duration, ease: EASE_GATE }}
          >
            <div
              className="absolute inset-y-0 left-0 w-px"
              style={{ background: "var(--rule-hi)" }}
            />
            <div className="absolute inset-y-0 left-2 hidden flex-col justify-between py-6 sm:flex">
              {Array.from({ length: 24 }, (_, i) => (
                <span
                  key={i}
                  className="block h-px"
                  style={{
                    width: i % 6 === 0 ? 14 : 7,
                    background: i % 6 === 0 ? "var(--rule-hi)" : "var(--rule)",
                  }}
                />
              ))}
            </div>
          </motion.div>

          {/* seam light: charges amber while loading, flares as the gate unlocks */}
          <motion.div
            className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2"
            style={{
              background: "var(--amber)",
              boxShadow: "0 0 18px rgba(232,163,61,0.55), 0 0 46px rgba(232,163,61,0.22)",
              transformOrigin: "50% 50%",
            }}
            initial={{ scaleY: 0, opacity: 0.5 }}
            animate={
              open
                ? { scaleY: 1, opacity: 0 }
                : { scaleY: progress, opacity: 0.9 }
            }
            transition={
              open
                ? { duration: 0.45, ease: "easeOut" }
                : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
            }
          />

          {/* plaque */}
          <motion.div
            className="absolute inset-0 grid place-items-center"
            initial={false}
            animate={{ opacity: open ? 0 : 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex flex-col items-center">
              {/* mobile stand-in for the film-edge ticks the seam loses below sm */}
              <div className="mb-4 flex items-end gap-2 sm:hidden" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className="block w-px"
                    style={{
                      height: i === 2 ? 10 : 6,
                      background: i === 2 ? "var(--rule-hi)" : "var(--rule)",
                    }}
                  />
                ))}
              </div>

              <div
                className="flex flex-col items-center px-6 py-6 text-center sm:px-14 sm:py-8"
                style={{ background: "var(--ink)", border: "1px solid var(--rule)" }}
              >
              <motion.span
                className="eyebrow"
                // tracking settles from wide to resting — the plate being set
                initial={{
                  opacity: 0,
                  y: 8,
                  letterSpacing: reduced ? "0.18em" : "0.3em",
                }}
                animate={{ opacity: 1, y: 0, letterSpacing: "0.18em" }}
                transition={{
                  duration: 0.6,
                  delay: 0.15,
                  letterSpacing: { duration: 0.8 },
                }}
              >
                evidence console
              </motion.span>

              <span className="mt-4 flex overflow-hidden font-display text-[clamp(30px,9vw,48px)] leading-none tracking-[-0.02em] text-bone sm:text-[clamp(38px,6vw,64px)]">
                {"Facechain".split("").map((ch, i) => (
                  <motion.span
                    key={i}
                    className="inline-block"
                    initial={{ y: "110%" }}
                    animate={{ y: "0%" }}
                    transition={{
                      duration: reduced ? 0 : 0.7,
                      delay: reduced ? 0 : 0.25 + i * 0.045,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </span>

              {/* real progress: the engine's own load stages */}
              <div className="mt-8 w-56 sm:w-72">
                <div className="h-px w-full" style={{ background: "var(--rule)" }}>
                  <motion.div
                    className="h-px"
                    style={{ background: "var(--amber)", transformOrigin: "0 50%" }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: progress }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="datum">{stage}</span>
                  <span className="font-mono text-[11px] tabular-nums text-faint">
                    {Math.round(progress * 100)}%
                  </span>
                </div>
              </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
