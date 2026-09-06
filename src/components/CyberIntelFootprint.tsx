"use client";

import { useEffect, useState, useCallback } from "react";
import type { DiscoveredProfile, IntelReport } from "@/lib/page-crawler";

type Props = {
  targetUrl: string;
};

export function CyberIntelFootprint({ targetUrl }: Props) {
  const [report, setReport] = useState<IntelReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async (url: string) => {
    if (!url) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        throw new Error(`Intelligence sweep returned HTTP ${res.status}`);
      }

      const data: IntelReport = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Intelligence crawl failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (targetUrl) {
      void runScan(targetUrl);
    }
  }, [targetUrl, runScan]);

  const platformStyle = (platform: DiscoveredProfile["platform"]) => {
    switch (platform) {
      case "devfolio":
        return "border-emerald-500/40 bg-emerald-950/20 text-emerald-400";
      case "linkedin":
        return "border-blue-500/40 bg-blue-950/20 text-blue-400";
      case "x":
        return "border-cyan-500/40 bg-cyan-950/20 text-cyan-300";
      case "instagram":
        return "border-fuchsia-500/40 bg-fuchsia-950/20 text-fuchsia-300";
      case "github":
        return "border-amber/40 bg-amber/10 text-amber";
      case "youtube":
        return "border-red-500/40 bg-red-950/20 text-red-400";
      case "reddit":
        return "border-orange-500/40 bg-orange-950/20 text-orange-400";
      default:
        return "border-rule/60 bg-bench/60 text-dim";
    }
  };

  return (
    <div
      data-testid="cyber-intel-panel"
      className="mt-6 border border-rule bg-bench/95 p-5 shadow-2xl transition-all"
    >
      {/* Radar Scan Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule/80 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                loading ? "animate-ping bg-amber" : "bg-verdict"
              }`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                loading ? "bg-amber" : "bg-verdict"
              }`}
            />
          </span>
          <div>
            <h4 className="font-mono text-[12px] font-bold uppercase tracking-widest text-bone">
              Cyber Intelligence // Outbound Footprint Radar
            </h4>
            <p className="font-mono text-[10px] text-dim">
              Recursive 1-hop link-in-bio crawler (Devfolio · X · Instagram · LinkedIn · Linktree)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runScan(targetUrl)}
          disabled={loading}
          data-testid="rescan-intel-btn"
          className="border border-rule/70 bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-dim transition-colors hover:border-amber hover:text-amber disabled:opacity-50"
        >
          {loading ? "Scanning Signals…" : "Re-Scan Footprint"}
        </button>
      </div>

      {/* Target Specimen URL Bar */}
      <div className="mt-3 flex items-center justify-between gap-2 border border-rule/40 bg-black/40 px-3 py-1.5 font-mono text-[10px]">
        <span className="text-dim truncate">Target: {targetUrl}</span>
        {report && (
          <span className="text-dim shrink-0">
            {report.elapsedMs}ms · {report.profiles.length} profiles discovered
          </span>
        )}
      </div>

      {/* Hub Detected Banner (Linktree / Beacons / Carrd) */}
      {report?.hubFound && (
        <div
          data-testid="hub-detected-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-verdict/40 bg-verdict/10 px-3 py-2 text-[11px]"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-verdict border border-verdict/60 px-1.5 py-0.5">
              1-Hop Bio-Hub Resolved
            </span>
            <span className="font-mono text-bone font-medium truncate max-w-[320px]">
              {report.hubFound}
            </span>
          </div>
          <span className="font-mono text-[10px] text-verdict/80 uppercase">
            Crawled Underlying Social Graph
          </span>
        </div>
      )}

      {/* Discovered Profiles Grid */}
      <div className="mt-4">
        {loading && !report ? (
          <div className="py-6 text-center font-mono text-[11px] text-dim animate-pulse">
            [ RADAR ACTIVE ] Interrogating DOM and following 1-hop identity hubs…
          </div>
        ) : error ? (
          <div className="py-3 font-mono text-[11px] text-reject">
            Telemetry notice: {error} (target page restricted outbound scraping)
          </div>
        ) : report && report.profiles.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
            {report.profiles.map((p, idx) => (
              <a
                key={`${p.url}-${idx}`}
                href={p.url}
                target="_blank"
                rel="noreferrer noopener"
                data-testid={`intel-profile-${p.platform}`}
                className={`group relative block border p-3 transition-all hover:scale-[1.01] hover:shadow-lg ${platformStyle(
                  p.platform
                )}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest opacity-90">
                    {p.platformName}
                  </span>
                  <span className="font-mono text-[8px] uppercase tracking-wider text-dim border border-rule/50 px-1 bg-black/40">
                    {p.source === "bio-hub" ? "via Bio-Hub" : "Page Outbound"}
                  </span>
                </div>

                <div className="mt-1.5 font-mono text-[12px] font-semibold text-bone group-hover:text-amber truncate">
                  {p.handle}
                </div>

                <div className="mt-1 font-mono text-[9px] text-dim truncate opacity-80">
                  {p.url.replace(/^https?:\/\//, "")}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="py-4 text-center font-mono text-[11px] text-dim border border-rule/30 bg-black/20">
            Isolated Specimen · No outbound identity claims or bio-hubs detected on this page.
          </div>
        )}
      </div>

      {/* Cryptographic Boundary Guard Note */}
      <div className="mt-4 border-t border-rule/60 pt-2.5 flex items-center justify-between font-mono text-[9px] text-dim">
        <span>SECURITY PERIMETER: OFF-CHAIN TELEMETRY ONLY</span>
        <span className="text-verdict/80">
          CANONICAL ON-CHAIN PROOF HASH REMAINS IMMUTABLE
        </span>
      </div>
    </div>
  );
}
