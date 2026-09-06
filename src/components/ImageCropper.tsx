"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConsoleButton } from "./ConsoleButton";

export type CropArea = {
  x: number; // 0..1 relative
  y: number;
  width: number;
  height: number;
};

export function ImageCropper({
  imageUrl,
  onApply,
  onCancel,
}: {
  imageUrl: string;
  onApply: (croppedBlob: Blob) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Crop normalized coordinates: 0..1 relative to image display
  const [crop, setCrop] = useState<CropArea>({
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8,
  });

  const [dragging, setDragging] = useState<"move" | "nw" | "ne" | "sw" | "se" | null>(null);
  const dragStart = useRef<{ mouseX: number; mouseY: number; initialCrop: CropArea }>({
    mouseX: 0,
    mouseY: 0,
    initialCrop: crop,
  });

  const handlePointerDown = (
    e: React.PointerEvent,
    action: "move" | "nw" | "ne" | "sw" | "se",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(action);
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialCrop: { ...crop },
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dx = (e.clientX - dragStart.current.mouseX) / rect.width;
    const dy = (e.clientY - dragStart.current.mouseY) / rect.height;
    const init = dragStart.current.initialCrop;

    let next = { ...init };

    if (dragging === "move") {
      next.x = Math.max(0, Math.min(1 - init.width, init.x + dx));
      next.y = Math.max(0, Math.min(1 - init.height, init.y + dy));
    } else if (dragging === "se") {
      next.width = Math.max(0.15, Math.min(1 - init.x, init.width + dx));
      next.height = Math.max(0.15, Math.min(1 - init.y, init.height + dy));
    } else if (dragging === "sw") {
      const maxDx = init.width - 0.15;
      const appliedDx = Math.min(maxDx, Math.max(-init.x, dx));
      next.x = init.x + appliedDx;
      next.width = init.width - appliedDx;
      next.height = Math.max(0.15, Math.min(1 - init.y, init.height + dy));
    } else if (dragging === "ne") {
      const maxDy = init.height - 0.15;
      const appliedDy = Math.min(maxDy, Math.max(-init.y, dy));
      next.y = init.y + appliedDy;
      next.height = init.height - appliedDy;
      next.width = Math.max(0.15, Math.min(1 - init.x, init.width + dx));
    } else if (dragging === "nw") {
      const maxDx = init.width - 0.15;
      const appliedDx = Math.min(maxDx, Math.max(-init.x, dx));
      const maxDy = init.height - 0.15;
      const appliedDy = Math.min(maxDy, Math.max(-init.y, dy));
      next.x = init.x + appliedDx;
      next.width = init.width - appliedDx;
      next.y = init.y + appliedDy;
      next.height = init.height - appliedDy;
    }

    setCrop(next);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setDragging(null);
    }
  };

  const performCrop = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;

    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cropPxX = Math.round(crop.x * natW);
    const cropPxY = Math.round(crop.y * natH);
    const cropPxW = Math.round(crop.width * natW);
    const cropPxH = Math.round(crop.height * natH);

    canvas.width = cropPxW;
    canvas.height = cropPxH;

    ctx.drawImage(
      img,
      cropPxX,
      cropPxY,
      cropPxW,
      cropPxH,
      0,
      0,
      cropPxW,
      cropPxH,
    );

    canvas.toBlob(
      (blob) => {
        if (blob) onApply(blob);
      },
      "image/jpeg",
      0.95,
    );
  }, [crop, onApply]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-rule bg-ink p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-rule pb-3">
          <div>
            <h3 className="font-serif text-lg text-bone">Manual Crop & Focus</h3>
            <p className="font-mono text-[11px] text-dim">
              Drag handles to frame the subject or specific face
            </p>
          </div>
          <div className="flex gap-2">
            <ConsoleButton variant="primary" filled onClick={performCrop}>
              Apply Crop
            </ConsoleButton>
            <ConsoleButton variant="ghost" onClick={onCancel}>
              Cancel
            </ConsoleButton>
          </div>
        </div>

        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative max-h-[60vh] overflow-hidden select-none touch-none border border-rule bg-black grid place-items-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="To crop"
            className="max-h-[58vh] max-w-full object-contain pointer-events-none"
          />

          {/* Dark Overlay Outside Crop */}
          <div
            className="absolute border-2 border-amber bg-amber/10 pointer-events-auto cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]"
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            }}
            onPointerDown={(e) => handlePointerDown(e, "move")}
          >
            {/* Rule-of-thirds grid lines */}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 border border-amber/30">
              <div className="border-r border-b border-amber/20" />
              <div className="border-r border-b border-amber/20" />
              <div className="border-b border-amber/20" />
              <div className="border-r border-b border-amber/20" />
              <div className="border-r border-b border-amber/20" />
              <div className="border-b border-amber/20" />
              <div className="border-r border-amber/20" />
              <div className="border-r border-amber/20" />
              <div />
            </div>

            {/* Corner Resize Handles */}
            <div
              className="absolute -top-1.5 -left-1.5 h-3.5 w-3.5 cursor-nwse-resize bg-amber border border-black"
              onPointerDown={(e) => handlePointerDown(e, "nw")}
            />
            <div
              className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 cursor-nesw-resize bg-amber border border-black"
              onPointerDown={(e) => handlePointerDown(e, "ne")}
            />
            <div
              className="absolute -bottom-1.5 -left-1.5 h-3.5 w-3.5 cursor-nesw-resize bg-amber border border-black"
              onPointerDown={(e) => handlePointerDown(e, "sw")}
            />
            <div
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize bg-amber border border-black"
              onPointerDown={(e) => handlePointerDown(e, "se")}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-dim">
          <span>Aspect Ratio: Freeform</span>
          <span>Tip: Focus on the person’s head & shoulders for best search accuracy</span>
        </div>
      </div>
    </div>
  );
}
