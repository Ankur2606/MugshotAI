"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

/**
 * The bench in depth: a calibration grid laid flat and receding under the
 * console, with the whole scene leaning a degree or two toward the pointer,
 * and a faint safelight glow trailing the cursor. Three layers, transforms
 * only, no canvas and no WebGL — it has to stay invisible to the frame budget
 * while the face models are doing real work on the GPU.
 */

const TILT = 1.6; // max scene lean, degrees
const LEAN = { stiffness: 55, damping: 18, mass: 1.1 };
const GLOW = { stiffness: 45, damping: 16, mass: 1.2 };

export function DepthField() {
  const reduced = useReducedMotion();

  const rx = useSpring(useMotionValue(0), LEAN);
  const ry = useSpring(useMotionValue(0), LEAN);
  const gx = useSpring(useMotionValue(-400), GLOW);
  const gy = useSpring(useMotionValue(-400), GLOW);

  useEffect(() => {
    if (reduced) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5; // -0.5 .. 0.5
      const ny = e.clientY / window.innerHeight - 0.5;
      ry.set(nx * TILT * 2);
      rx.set(-ny * TILT * 2);
      gx.set(e.clientX);
      gy.set(e.clientY);
    };
    const onLeave = () => {
      rx.set(0);
      ry.set(0);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, rx, ry, gx, gy]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ perspective: 1100 }}
    >
      <motion.div
        className="absolute inset-0"
        style={{
          rotateX: rx,
          rotateY: ry,
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
      >
        {/* far wall: sparse vertical hairlines */}
        <div
          className="absolute inset-0"
          style={{
            transform: "translateZ(-360px) scale(1.5)",
            backgroundImage:
              "repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px 160px)",
            opacity: 0.28,
            maskImage:
              "linear-gradient(to bottom, transparent 0%, black 30%, black 65%, transparent 100%)",
          }}
        />

        {/* bench: the grid laid flat, receding under the console */}
        <div
          className="absolute left-1/2 top-[58%] h-[130vh] w-[240vw] -translate-x-1/2"
          style={{
            transform: "translateX(-50%) rotateX(74deg)",
            transformOrigin: "50% 0%",
            backgroundImage:
              "repeating-linear-gradient(0deg, var(--rule) 0 1px, transparent 1px 90px)," +
              "repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px 90px)",
            opacity: 0.5,
            maskImage:
              "radial-gradient(ellipse 55% 62% at 50% 0%, black 0%, transparent 78%)",
          }}
        >
          {/* slow conveyor drift down the bench; one extra tile of grid so the
              loop point is invisible. Skipped under reduced motion. */}
          {!reduced && (
            <motion.div
              className="absolute inset-x-0 -top-[90px] bottom-0"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, var(--amber) 0 1px, transparent 1px 450px)",
                opacity: 0.14,
                willChange: "transform",
              }}
              animate={{ y: [0, 450] }}
              transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
            />
          )}
        </div>
      </motion.div>

      {/* safelight: a dim warm pool that trails the cursor */}
      {!reduced && (
        <motion.div
          className="absolute h-[520px] w-[520px] rounded-full"
          style={{
            x: gx,
            y: gy,
            translateX: "-50%",
            translateY: "-50%",
            background:
              "radial-gradient(circle, rgba(232,163,61,0.07) 0%, rgba(232,163,61,0.025) 42%, transparent 70%)",
            willChange: "transform",
          }}
        />
      )}

      {/* settles the scene back into the page's ground color at the edges */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--ink) 0%, transparent 18%, transparent 70%, var(--ink) 100%)",
        }}
      />
    </div>
  );
}
