"use client";

import { useEffect, useMemo } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

/**
 * The bench in depth, drawn honestly: perspective is computed into the SVG
 * geometry instead of asked of the compositor. The previous version used a
 * real 3D-transformed plane (rotateX on a 240vw layer), and on some GPUs
 * Chrome's tiler gave up on the projected bounds — everything below the first
 * viewport rendered black until a resize forced a repaint. Flat SVG lines
 * cannot fail that way.
 *
 * Three quiet layers: a far wall of hairlines above the horizon, a projected
 * bench grid below it with a slow amber scan travelling down it, and a
 * safelight pool trailing the cursor. Pointer parallax is a few 2D pixels on
 * springs — no perspective, no preserve-3d, nothing for a tiler to misjudge.
 */

const W = 1440;
const H = 900;
const VPX = W / 2; // vanishing point
const HORIZON = 380;

const PARALLAX = 9; // px of scene drift toward the pointer
const LEAN = { stiffness: 55, damping: 18, mass: 1.1 };
const GLOW = { stiffness: 45, damping: 16, mass: 1.2 };

function benchGeometry() {
  // ground rows: linear in world space, quadratic in screen space
  const rows: number[] = [];
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    rows.push(HORIZON + (H - HORIZON) * Math.pow(t, 2.2));
  }
  // verticals: fan out from near the vanishing point to the bottom edge
  const cols: Array<{ x1: number; x2: number }> = [];
  for (let xb = -1200; xb <= W + 1200; xb += 180) {
    cols.push({ x1: VPX + (xb - VPX) * 0.06, x2: xb });
  }
  // far wall hairlines above the horizon
  const wall: number[] = [];
  for (let x = 40; x <= W - 40; x += 160) wall.push(x);
  return { rows, cols, wall };
}

export function DepthField() {
  const reduced = useReducedMotion();
  const { rows, cols, wall } = useMemo(benchGeometry, []);

  const sx = useSpring(useMotionValue(0), LEAN);
  const sy = useSpring(useMotionValue(0), LEAN);
  const gx = useSpring(useMotionValue(-600), GLOW);
  const gy = useSpring(useMotionValue(-600), GLOW);

  useEffect(() => {
    if (reduced) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      sx.set(-nx * PARALLAX * 2);
      sy.set(-ny * PARALLAX);
      gx.set(e.clientX);
      gy.set(e.clientY);
    };
    const onLeave = () => {
      sx.set(0);
      sy.set(0);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, sx, sy, gx, gy]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <motion.svg
        className="absolute inset-[-16px] h-[calc(100%+32px)] w-[calc(100%+32px)]"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ x: sx, y: sy, willChange: "transform" }}
      >
        <defs>
          {/* the wall dissolves before it reaches the type */}
          <linearGradient id="df-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--rule)" stopOpacity="0" />
            <stop offset="0.45" stopColor="var(--rule)" stopOpacity="0.5" />
            <stop offset="1" stopColor="var(--rule)" stopOpacity="0" />
          </linearGradient>
          {/* the bench fades at its far edge and at the sides */}
          <radialGradient id="df-bench" cx="0.5" cy="0" r="1">
            <stop offset="0" stopColor="white" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.28" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="df-bench-mask">
            <rect x="0" y={HORIZON} width={W} height={H - HORIZON} fill="url(#df-bench)" />
          </mask>
        </defs>

        {/* far wall */}
        <g>
          {wall.map((x) => (
            <line key={x} x1={x} y1={60} x2={x} y2={HORIZON} stroke="url(#df-wall)" strokeWidth="1" />
          ))}
        </g>

        {/* bench grid, pre-projected */}
        <g mask="url(#df-bench-mask)">
          {rows.map((y) => (
            <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="var(--rule)" strokeWidth="1" />
          ))}
          {cols.map(({ x1, x2 }) => (
            <line key={x2} x1={x1} y1={HORIZON} x2={x2} y2={H} stroke="var(--rule)" strokeWidth="1" />
          ))}

          {/* the scan: one amber row travelling down the bench, then resting.
              SVG is XML — this is the same SMIL vocabulary as the workflow
              diagrams in docs/, so the page and its documentation animate in
              one language. */}
          {!reduced && (
            <line x1={0} y1={0} x2={W} y2={0} stroke="var(--amber)" strokeWidth="1" opacity="0">
              <animate
                attributeName="y1"
                values={`${HORIZON};${H}`}
                dur="7s"
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.6 1"
              />
              <animate
                attributeName="y2"
                values={`${HORIZON};${H}`}
                dur="7s"
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.6 1"
              />
              <animate
                attributeName="opacity"
                values="0;0.35;0.12;0"
                keyTimes="0;0.15;0.7;1"
                dur="7s"
                repeatCount="indefinite"
              />
            </line>
          )}
        </g>
      </motion.svg>

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

      {/* settle the scene back into the page ground at the edges */}
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
