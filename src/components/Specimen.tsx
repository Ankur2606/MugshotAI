"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ConsoleButton } from "./ConsoleButton";
import {
  frameToJpeg,
  loadEngine,
  readAllFaces,
  readFace,
  readFaceStable,
  type FaceReading,
} from "@/lib/human-client";
import { ImageCropper } from "./ImageCropper";

export type Probe = {
  blob: Blob;
  previewUrl: string;
  reading: FaceReading;
  allReadings?: FaceReading[];
  selectedFaceIndex?: number | "all";
  imageSize?: { width: number; height: number };
  capturedAt: number;
  origin: "camera" | "file";
};

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Station I. Either mode ends in the same place: one JPEG and one descriptor.
 * The live mesh overlay is there so the operator can see the detector actually
 * locking on before committing a frame, not for decoration.
 */
export function Specimen({
  onProbe,
  probe,
  busy,
}: {
  onProbe: (p: Probe | null) => void;
  probe: Probe | null;
  busy: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [engine, setEngine] = useState("cold");
  const [cameraOn, setCameraOn] = useState(false);
  const [live, setLive] = useState<FaceReading | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [showCropper, setShowCropper] = useState(false);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const reduced = useReducedMotion();

  const handleApplyCrop = useCallback(
    async (croppedBlob: Blob) => {
      setShowCropper(false);
      setNote(null);
      const url = URL.createObjectURL(croppedBlob);
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => { });
      const allReadings = await readAllFaces(img);
      const reading = allReadings[0];
      if (!reading) {
        setNote("No face detected in the cropped region. Try a broader crop.");
        return;
      }
      onProbe({
        blob: croppedBlob,
        previewUrl: url,
        reading,
        allReadings,
        selectedFaceIndex: "all",
        imageSize: { width: img.naturalWidth, height: img.naturalHeight },
        capturedAt: Math.floor(Date.now() / 1000),
        origin: "file",
      });
    },
    [onProbe],
  );

  useEffect(() => {
    loadEngine(setEngine).catch((e) =>
      setNote(e instanceof Error ? e.message : "The face engine failed to load."),
    );
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setLive(null);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const drawMesh = useCallback((reading: FaceReading | null) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth || canvas.clientWidth;
    canvas.height = video.videoHeight || canvas.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!reading) return;

    const [x, y, w, h] = reading.box;

    // corner brackets rather than a full box: less visual noise over the face
    ctx.strokeStyle = "#e8a33d";
    ctx.lineWidth = 1.5;
    const arm = Math.min(w, h) * 0.16;
    const corners: Array<[number, number, number, number]> = [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + arm * sx, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + arm * sy);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(232,163,61,0.55)";
    for (const [px, py] of reading.mesh) ctx.fillRect(px, py, 1.2, 1.2);
  }, []);

  const startCamera = useCallback(async () => {
    setNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const reading = await readFace(videoRef.current);
          setLive(reading);
          drawMesh(reading);
        } catch {
          /* a dropped frame is not worth surfacing */
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch (e) {
      setNote(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera access was declined. Allow it in the browser, or upload a photo instead."
          : "No camera is available. Upload a photo instead.",
      );
    }
  }, [drawMesh]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setNote(null);
    // the committed probe is worth the second inference pass; the live
    // preview above stays single-pass so the loop stays smooth
    const reading = await readFaceStable(video);
    if (!reading) {
      setNote("No face in that frame. Move into the light and try again.");
      return;
    }
    const allReadings = await readAllFaces(video);
    // the shutter fires only once the frame is known good — a flash on a
    // failed capture would lie about what happened
    if (!reduced) setFlash(true);
    const blob = await frameToJpeg(video);
    onProbe({
      blob,
      previewUrl: URL.createObjectURL(blob),
      reading,
      allReadings: allReadings.length > 0 ? allReadings : [reading],
      selectedFaceIndex: "all",
      imageSize: { width: video.videoWidth, height: video.videoHeight },
      capturedAt: Math.floor(Date.now() / 1000),
      origin: "camera",
    });
    stopCamera();
  }, [onProbe, stopCamera, reduced]);

  const takeFile = useCallback(
    async (file: File) => {
      setNote(null);
      const url = URL.createObjectURL(file);
      setUploadPreviewUrl(url);
      setUploadProcessing(true);

      // Paint the selected image and veil before local face inference begins.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const img = new Image();
      img.src = url;
      try {
        await img.decode();
        const allReadings = await readAllFaces(img);
        const reading = allReadings[0];
        if (!reading) {
          setNote("No face found in that image. Try a clearer, front-facing photo.");
          return;
        }
        const blob = await frameToJpeg(img);
        onProbe({
          blob,
          previewUrl: URL.createObjectURL(blob),
          reading,
          allReadings,
          selectedFaceIndex: "all",
          imageSize: { width: img.naturalWidth, height: img.naturalHeight },
          capturedAt: Math.floor(Date.now() / 1000),
          origin: "file",
        });
      } catch {
        setNote("That file could not be read as an image.");
      } finally {
        setUploadProcessing(false);
        setUploadPreviewUrl(null);
        URL.revokeObjectURL(url);
      }
    },
    [onProbe],
  );

  const shown = probe?.reading ?? live;

  const selectFace = useCallback(
    (selectedFaceIndex: number | "all") => {
      if (!probe || !probe.allReadings) return;
      onProbe({
        ...probe,
        selectedFaceIndex,
        reading: selectedFaceIndex === "all"
          ? probe.allReadings[0]
          : probe.allReadings[selectedFaceIndex],
      });
    },
    [onProbe, probe],
  );

  // the housing brackets tell the station's state at a glance:
  // hairline at rest, safelight while the detector runs, verdict once held
  const bracketColor = probe
    ? "var(--verdict)"
    : cameraOn
      ? "var(--amber)"
      : "var(--rule-hi)";

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(280px,380px)_1fr]">
      {/* viewport */}
      <div>
        <div className="relative aspect-[4/3] overflow-hidden border border-rule bg-black">
          {probe ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={probe.previewUrl}
              alt="Captured probe"
              className="h-full w-full object-contain"
            />
          ) : uploadPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadPreviewUrl}
              alt="Selected upload"
              className="h-full w-full object-contain"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              <canvas
                ref={overlayRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
                style={{ transform: "scaleX(-1)" }}
              />
            </>
          )}

          {uploadProcessing && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-gray-500/55 backdrop-blur-[1px]"
            >
              <span className="h-9 w-9 animate-spin rounded-full border-2 border-bone/30 border-t-amber" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone">
                Processing image
              </span>
            </div>
          )}

          {probe?.allReadings && probe.allReadings.length > 0 && probe.imageSize && (
            <FaceRegionOverlay
              readings={probe.allReadings}
              imageSize={probe.imageSize}
              selectedFaceIndex={probe.selectedFaceIndex ?? "all"}
              onSelect={selectFace}
            />
          )}

          {/* corner brackets on the housing, echoing the detector's marks inside */}
          {(
            [
              "left-1 top-1 border-l border-t",
              "right-1 top-1 border-r border-t",
              "bottom-1 left-1 border-b border-l",
              "bottom-1 right-1 border-b border-r",
            ] as const
          ).map((pos) => (
            <motion.span
              key={pos}
              aria-hidden
              className={`pointer-events-none absolute z-10 h-3.5 w-3.5 ${pos}`}
              initial={false}
              animate={{ borderColor: bracketColor }}
              transition={{ duration: 0.4, ease: EASE }}
            />
          ))}

          {!cameraOn && !probe && !uploadPreviewUrl && (
            <div className="absolute inset-0 grid place-items-center">
              <motion.span
                className="eyebrow"
                animate={reduced ? undefined : { opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                viewport idle
              </motion.span>
            </div>
          )}

          {cameraOn && !probe && (
            <motion.div
              className="pointer-events-none absolute inset-x-0 h-px"
              style={{ background: "rgba(232,163,61,0.35)" }}
              animate={{ top: ["2%", "98%", "2%"] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            />
          )}

          {/* the shutter: one bone flash over the glass, then the held still */}
          <AnimatePresence>
            {flash && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-20"
                style={{ background: "var(--bone)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.9, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.26, ease: EASE, times: [0, 0.35, 1] }}
                onAnimationComplete={() => setFlash(false)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Multi-Face Indicator & Selector */}
        {probe && probe.allReadings && probe.allReadings.length > 1 && (
          <div className="mt-2.5 border border-rule bg-bench/60 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-amber font-semibold flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
                {probe.allReadings.length} Faces Discovered
              </span>
              <span className="font-mono text-[9px] text-dim">
                Select target or trace all
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                  onClick={() => {
                    selectFace("all");
                  }}
                className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors ${probe.selectedFaceIndex === "all"
                    ? "border-amber bg-amber/20 text-amber font-semibold"
                    : "border-rule text-dim hover:text-bone"
                  }`}
              >
                ✦ All Faces + Scene (Dual-Path)
              </button>
              {probe.allReadings.map((r, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    selectFace(idx);
                  }}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors ${probe.selectedFaceIndex === idx
                      ? "border-verdict bg-verdict/20 text-verdict font-semibold"
                      : "border-rule text-dim hover:text-bone"
                    }`}
                >
                  Person {idx + 1} ({(r.score * 100).toFixed(0)}%)
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {!probe && !cameraOn && (
            <ConsoleButton
              variant="primary"
              onClick={() => void startCamera()}
              disabled={engine !== "ready"}
              className="w-full sm:w-auto"
            >
              Start camera
            </ConsoleButton>
          )}
          {cameraOn && !probe && (
            <>
              <ConsoleButton
                variant="primary"
                filled
                onClick={() => void capture()}
                disabled={!live}
                className="w-full sm:w-auto"
              >
                Capture frame
              </ConsoleButton>
              <ConsoleButton variant="ghost" onClick={stopCamera}>
                Stop
              </ConsoleButton>
            </>
          )}
          {!probe && (
            <ConsoleButton
              variant="quiet"
              onClick={() => fileRef.current?.click()}
              disabled={engine !== "ready" || uploadProcessing}
            >
              Upload photo
            </ConsoleButton>
          )}
          {probe && (
            <>
              <ConsoleButton
                variant="quiet"
                onClick={() => setShowCropper(true)}
                disabled={busy}
              >
                Crop & Refine
              </ConsoleButton>
              <ConsoleButton variant="ghost" onClick={() => onProbe(null)} disabled={busy}>
                Discard specimen
              </ConsoleButton>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void takeFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {showCropper && probe && (
          <ImageCropper
            imageUrl={probe.previewUrl}
            onApply={(blob) => void handleApplyCrop(blob)}
            onCancel={() => setShowCropper(false)}
          />
        )}
      </div>

      {/* readout */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 self-start sm:grid-cols-3">
        <Readout label="engine" value={engine} tone={engine === "ready" ? "ok" : "wait"} index={0} />
        <Readout
          label="detector"
          value={shown ? `${(shown.score * 100).toFixed(1)}%` : "—"}
          tone={shown ? "ok" : "idle"}
          index={1}
        />
        <Readout
          label="descriptor"
          value={shown ? `${shown.embedding.length}-d` : "—"}
          tone={shown ? "ok" : "idle"}
          index={2}
        />
        <Readout
          label="anti-spoof"
          value={shown?.real !== null && shown?.real !== undefined ? `${(shown.real * 100).toFixed(0)}% real` : "—"}
          tone={shown?.real != null ? (shown.real > 0.5 ? "ok" : "bad") : "idle"}
          index={3}
        />
        <Readout
          label="liveness"
          value={shown?.live !== null && shown?.live !== undefined ? `${(shown.live * 100).toFixed(0)}% live` : "—"}
          tone={shown?.live != null ? (shown.live > 0.5 ? "ok" : "bad") : "idle"}
          index={4}
        />
        <Readout
          label="source"
          value={probe ? probe.origin : cameraOn ? "camera, live" : "—"}
          tone={probe ? "ok" : "idle"}
          index={5}
        />

        {note && (
          <p className="col-span-full border-l-2 border-reject pl-3 text-[13px] text-bone">{note}</p>
        )}

        {!note && !probe && (
          <p className="col-span-full max-w-md text-[13px] leading-relaxed text-dim">
            The descriptor is computed here in the browser. Only the captured JPEG is sent
            onward, and only when you run the trace.
          </p>
        )}
      </dl>
    </div>
  );
}

function FaceRegionOverlay({
  readings,
  imageSize,
  selectedFaceIndex,
  onSelect,
}: {
  readings: FaceReading[];
  imageSize: { width: number; height: number };
  selectedFaceIndex: number | "all";
  onSelect: (index: number) => void;
}) {
  const selected = typeof selectedFaceIndex === "number" ? selectedFaceIndex : null;

  return (
    <svg
      aria-label="Detected face regions"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
      viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {readings.map((reading, index) => {
        const [x, y, width, height] = reading.boxRaw
          ? [
              reading.boxRaw[0] * imageSize.width,
              reading.boxRaw[1] * imageSize.height,
              reading.boxRaw[2] * imageSize.width,
              reading.boxRaw[3] * imageSize.height,
            ]
          : reading.box;
        const isActive = selected === null || selected === index;

        return (
          <motion.g
            key={index}
            initial={{ opacity: 0, scale: 0.96, transformOrigin: `${x + width / 2}px ${y + height / 2}px` }}
            animate={{ opacity: isActive ? 1 : 0.32, scale: isActive ? 1 : 0.985 }}
            transition={{ duration: 0.42, ease: EASE }}
            style={{ willChange: "transform, opacity" }}
          >
            <motion.rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={Math.max(6, width * 0.04)}
              fill={isActive ? "rgba(232,163,61,0.09)" : "rgba(124,135,145,0.04)"}
              stroke={isActive ? "var(--amber)" : "var(--dim)"}
              strokeWidth={Math.max(2, imageSize.width * 0.003)}
              strokeDasharray={isActive ? "none" : "8 7"}
              className="pointer-events-auto cursor-pointer"
              onClick={() => onSelect(index)}
              whileHover={{ fill: "rgba(232,163,61,0.18)" }}
              transition={{ duration: 0.22, ease: EASE }}
            />
            <motion.rect
              aria-hidden
              x={x - 3}
              y={y - 3}
              width={width + 6}
              height={height + 6}
              rx={Math.max(8, width * 0.05)}
              fill="none"
              stroke="var(--amber)"
              strokeWidth={Math.max(1, imageSize.width * 0.0015)}
              animate={isActive ? { opacity: [0.7, 0, 0.7] } : { opacity: 0 }}
              transition={{ duration: 2.4, repeat: isActive ? Infinity : 0, ease: "easeInOut" }}
            />
            <motion.text
              x={x + 8}
              y={Math.max(18, y - 8)}
              fill={isActive ? "var(--amber)" : "var(--dim)"}
              fontFamily="var(--font-jetbrains), ui-monospace, monospace"
              fontSize={Math.max(12, imageSize.width * 0.018)}
              fontWeight="700"
              letterSpacing="1.5"
            >
              P{index + 1}
            </motion.text>
          </motion.g>
        );
      })}
    </svg>
  );
}

function Readout({
  label,
  value,
  tone,
  index,
}: {
  label: string;
  value: string;
  tone: "ok" | "bad" | "wait" | "idle";
  index: number;
}) {
  const reduced = useReducedMotion();
  const color = {
    ok: "var(--bone)",
    bad: "var(--reject)",
    wait: "var(--amber)",
    idle: "var(--faint)",
  }[tone];
  const held = value !== "—";
  return (
    <div className="border-t border-rule pt-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-mono text-[13px]" style={{ color }}>
        {/* keyed on idle↔held, not the text itself, so live score ticks
            don't re-run the entrance every frame */}
        <motion.span
          key={held ? "held" : "idle"}
          className="inline-block"
          initial={held && !reduced ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: index * 0.05 }}
        >
          {value}
        </motion.span>
      </dd>
    </div>
  );
}
