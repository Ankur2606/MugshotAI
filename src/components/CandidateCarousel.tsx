"use client";

import { useRef } from "react";
import { motion } from "motion/react";

export type CarouselCandidate = {
  key: string;
  url: string;
  imageUrl: string;
  title: string;
  source: string;
  thumb: string | null;
  similarityBp: number | null;
  probeCategory?: string;
  probeLabel?: string;
};

export function CandidateCarousel({
  candidates,
  thresholdBp,
  selectedKey,
  onSelect,
}: {
  candidates: CarouselCandidate[];
  thresholdBp: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const offset = direction === "left" ? -340 : 340;
    scrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  if (candidates.length === 0) return null;

  return (
    <div className="relative mt-5 w-full min-w-0 max-w-full overflow-hidden border border-rule bg-ink/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-amber font-semibold">
            ✦ Discovered Evidence Carousel ({candidates.length})
          </span>
          <span className="font-mono text-[10px] text-dim">
            Swipe or slide to inspect candidates
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => scroll("left")}
            className="flex h-7 w-7 items-center justify-center border border-rule bg-bench font-mono text-sm text-dim transition-colors hover:border-amber hover:text-amber"
            title="Scroll left"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            className="flex h-7 w-7 items-center justify-center border border-rule bg-bench font-mono text-sm text-dim transition-colors hover:border-amber hover:text-amber"
            title="Scroll right"
          >
            ›
          </button>
        </div>
      </div>

      {/* Card Track */}
      <div
        ref={scrollRef}
        className="flex w-full min-w-0 max-w-full gap-4 overflow-x-auto pb-3 pt-1 scroll-smooth no-scrollbar"
      >
        {candidates.map((c, i) => {
          const isSelected = selectedKey === c.key;
          const score = c.similarityBp !== null ? (c.similarityBp / 100).toFixed(1) : null;
          const passed = c.similarityBp !== null && c.similarityBp >= thresholdBp;

          return (
            <motion.div
              key={c.key}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.4) }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              onClick={() => onSelect(c.key)}
              className={`relative flex w-72 shrink-0 cursor-pointer flex-col border transition-all ${
                isSelected
                  ? "border-amber bg-bench-hi shadow-[0_0_20px_rgba(232,163,61,0.25)]"
                  : passed
                    ? "border-verdict/60 bg-bench/90 hover:border-amber/60"
                    : "border-rule bg-ink/90 hover:border-rule-hi"
              }`}
            >
              {/* Category Banner */}
              <div className="flex items-center justify-between border-b border-rule/70 px-3 py-1.5 bg-black/40">
                <span className="font-mono text-[9px] uppercase tracking-wider text-dim truncate max-w-[150px]">
                  {c.probeLabel || (c.probeCategory === "osint" ? "Sherlock OSINT" : "Scene Match")}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-bone font-medium">
                  {c.source}
                </span>
              </div>

              {/* Thumbnail Image */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/50 border-b border-rule/50">
                {c.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.thumb}
                    alt={c.title}
                    className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-bench font-mono text-[10px] text-dim animate-pulse">
                    Scanning Face...
                  </div>
                )}

                {/* Score Pill */}
                {score && (
                  <div
                    className={`absolute bottom-2 right-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider backdrop-blur-md ${
                      passed
                        ? "bg-verdict/90 text-black shadow-lg"
                        : "bg-reject/90 text-bone"
                    }`}
                  >
                    {score}% Match
                  </div>
                )}
              </div>

              {/* Content Body */}
              <div className="flex flex-1 flex-col justify-between p-3">
                <div>
                  <h4
                    className="line-clamp-2 text-xs font-serif leading-snug text-bone hover:text-amber transition-colors"
                    title={c.title}
                  >
                    {c.title}
                  </h4>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 block truncate font-mono text-[10px] text-dim hover:text-amber underline decoration-rule-hi"
                  >
                    {c.url}
                  </a>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-rule/50 pt-2">
                  <span
                    className={`font-mono text-[9px] uppercase tracking-wider ${
                      isSelected ? "text-amber font-bold" : "text-dim"
                    }`}
                  >
                    {isSelected ? "★ Active Seal Target" : "Click to Inspect"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(c.key);
                    }}
                    className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                      isSelected
                        ? "bg-amber text-black font-semibold"
                        : "border border-rule hover:border-amber hover:text-amber text-dim"
                    }`}
                  >
                    {isSelected ? "Selected" : "Select"}
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
