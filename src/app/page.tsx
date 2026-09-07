"use client";

import dynamic from "next/dynamic";

// The console owns a webcam, a canvas and a WebGL model runtime, none of which
// exist during server rendering. Loading it client-only keeps Human's browser
// bundle off the server graph entirely.
const Docket = dynamic(() => import("@/components/Docket").then((m) => m.Docket), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-[1180px] px-6 py-24 sm:px-10">
      <span className="eyebrow">face &rarr; post &rarr; chain</span>
      <p className="mt-4 font-display text-[clamp(44px,7vw,86px)] leading-[0.92] tracking-[-0.02em]">
        MugshotAI
      </p>
      <p className="datum mt-6">loading console…</p>
    </div>
  ),
});

export default function Home() {
  return <Docket />;
}
