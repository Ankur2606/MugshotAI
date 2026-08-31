"use client";

import dynamic from "next/dynamic";

const SelfTest = dynamic(() => import("@/components/SelfTest").then((m) => m.SelfTest), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-[900px] px-6 py-24">
      <p className="datum">loading engine&#8230;</p>
    </div>
  ),
});

export default function Page() {
  return <SelfTest />;
}
