"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

/**
 * Kinetic wordmark: the string is split into characters, and each character
 * carries its own spring. A single pointermove listener measures the distance
 * from the cursor to every glyph and pushes the near ones away; the springs
 * pull them home when the cursor leaves. All movement is written straight to
 * motion values, so nothing re-renders per frame.
 *
 * Hover is a mouse idea, so on touch devices and under reduced motion the
 * text simply renders still.
 */

const RADIUS = 150; // px within which a glyph reacts
const PUSH = 42; // max displacement in px
const SPRING = { stiffness: 320, damping: 22, mass: 0.9 };

type Glyph = {
  x: ReturnType<typeof useSpring>;
  y: ReturnType<typeof useSpring>;
  r: ReturnType<typeof useSpring>;
};

function Char({
  ch,
  glyph,
  register,
}: {
  ch: string;
  glyph: Glyph;
  register: (el: HTMLSpanElement | null) => void;
}) {
  return (
    <motion.span
      ref={register}
      className="inline-block will-change-transform"
      style={{ x: glyph.x, y: glyph.y, rotate: glyph.r }}
    >
      {ch === " " ? " " : ch}
    </motion.span>
  );
}

export function ScatterText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const chars = useMemo(() => text.split(""), [text]);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const centers = useRef<{ x: number; y: number }[]>([]);
  const raf = useRef(0);

  // One spring pair per character. The count is fixed for a given string, so
  // calling hooks in this loop is stable across renders.
  const glyphs: Glyph[] = [];
  for (let i = 0; i < chars.length; i++) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const x = useSpring(useMotionValue(0), SPRING);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const y = useSpring(useMotionValue(0), SPRING);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const r = useSpring(useMotionValue(0), { ...SPRING, stiffness: 260 });
    glyphs.push({ x, y, r });
  }
  const glyphsRef = useRef(glyphs);
  glyphsRef.current = glyphs;

  useEffect(() => {
    if (reduced) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const measure = () => {
      centers.current = spanRefs.current.map((el) => {
        if (!el) return { x: -9999, y: -9999 };
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
    };
    measure();

    let pointer: { x: number; y: number } | null = null;

    const apply = () => {
      raf.current = 0;
      if (!pointer) return;
      const g = glyphsRef.current;
      for (let i = 0; i < g.length; i++) {
        const c = centers.current[i];
        if (!c) continue;
        const dx = c.x - pointer.x;
        const dy = c.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < RADIUS && dist > 0.001) {
          // Quadratic falloff: a glyph under the cursor flees hard, one at the
          // edge of the radius barely leans.
          const force = (1 - dist / RADIUS) ** 2 * PUSH;
          g[i].x.set((dx / dist) * force);
          g[i].y.set((dy / dist) * force);
          g[i].r.set((dx / dist) * force * 0.35);
        } else {
          g[i].x.set(0);
          g[i].y.set(0);
          g[i].r.set(0);
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!raf.current) raf.current = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      pointer = null;
      for (const g of glyphsRef.current) {
        g.x.set(0);
        g.y.set(0);
        g.r.set(0);
      }
    };
    const onLayout = () => measure();

    // Listen on the document so glyphs settle home even when the cursor exits
    // sideways at speed, and re-measure on anything that moves the header.
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, { passive: true });

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [reduced, text]);

  return (
    <span ref={rootRef} className={className} aria-label={text} role="text">
      <span aria-hidden className="inline-block">
        {chars.map((ch, i) => (
          <Char
            key={`${ch}-${i}`}
            ch={ch}
            glyph={glyphs[i]}
            register={(el) => {
              spanRefs.current[i] = el;
            }}
          />
        ))}
      </span>
    </span>
  );
}
