"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { DiscoveredProfile, IntelReport, TargetSpecimen } from "@/lib/page-crawler";

type Props = {
  primaryUrl: string;
  targets?: TargetSpecimen[];
};

export function CyberIntelFootprint({ primaryUrl, targets = [] }: Props) {
  const [reports, setReports] = useState<IntelReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>("all");

  const runScan = useCallback(async () => {
    if (!primaryUrl && targets.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      if (targets.length > 1) {
        // Multi-category sweep across all detected persons & scene
        const res = await fetch("/api/intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setReports(data.reports || []);
      } else {
        // Single target sweep
        const target = targets[0] || { url: primaryUrl };
        const res = await fetch("/api/intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: target.url,
            category: target.category,
            label: target.label,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: IntelReport = await res.json();
        setReports([data]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Intelligence crawl failed");
    } finally {
      setLoading(false);
    }
  }, [primaryUrl, targets]);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  // Aggregate all profiles across reports, deduplicating by URL
  const allProfiles = useMemo(() => {
    const map = new Map<string, DiscoveredProfile>();
    for (const rep of reports) {
      for (const p of rep.profiles) {
        const norm = p.url.toLowerCase().replace(/\/+$/, "");
        if (!map.has(norm)) {
          map.set(norm, p);
        } else {
          // If already seen, prioritize "author" role over generic "commenter"
          const existing = map.get(norm)!;
          if (p.source === "author") {
            map.set(norm, p);
          }
        }
      }
    }
    return Array.from(map.values());
  }, [reports]);

  // Distinct category filters (e.g. "Scene Context", "Person 1", etc.)
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of allProfiles) {
      if (p.categoryLabel) cats.add(p.categoryLabel);
    }
    return Array.from(cats);
  }, [allProfiles]);

  const filteredProfiles = useMemo(() => {
    if (activeCategoryFilter === "all") return allProfiles;
    return allProfiles.filter((p) => p.categoryLabel === activeCategoryFilter);
  }, [allProfiles, activeCategoryFilter]);

  // Separate authors, commenters/tagged, and outbound profiles for clear visual hierarchy
  const authors = filteredProfiles.filter((p) => p.source === "author");
  const commenters = filteredProfiles.filter((p) => p.source === "commenter");
  const outbounds = filteredProfiles.filter((p) => p.source === "page" || p.source === "bio-hub");

  const bioHubsFound = useMemo(() => {
    return Array.from(new Set(reports.map((r) => r.hubFound).filter(Boolean))) as string[];
  }, [reports]);

  const platformStyle = (platform: DiscoveredProfile["platform"], source: DiscoveredProfile["source"]) => {
    if (source === "author") {
      return "border-amber/80 bg-amber/15 text-amber ring-1 ring-amber/40";
    }
    if (source === "commenter") {
      return "border-emerald-500/60 bg-emerald-950/30 text-emerald-400";
    }
    switch (platform) {
      case "devfolio":
        return "border-emerald-500/40 bg-emerald-950/20 text-emerald-400";
      case "linkedin":
        return "border-blue-500/50 bg-blue-950/20 text-blue-300";
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
              Cyber Intelligence // Deep Identity & Bio-Hub Radar
            </h4>
            <p className="font-mono text-[10px] text-dim">
              Resolves post authors, commenters/tagged profiles, and recursive 1-hop bio hubs (Linktree, Beacons, Devfolio)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runScan()}
          disabled={loading}
          data-testid="rescan-intel-btn"
          className="border border-rule/70 bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-dim transition-colors hover:border-amber hover:text-amber disabled:opacity-50"
        >
          {loading ? "Sweeping DOM & Hubs…" : "Re-Scan All Leads"}
        </button>
      </div>

      {/* Target Specimen URL Bar */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-rule/40 bg-black/40 px-3 py-1.5 font-mono text-[10px]">
        <span className="text-dim truncate max-w-[500px]">
          Target: {primaryUrl}
        </span>
        <span className="text-dim shrink-0">
          {reports.length} target(s) swept · {allProfiles.length} identities resolved
        </span>
      </div>

      {/* Category Tabs (Scene Context / Person 1 / Person 2) */}
      {availableCategories.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-b border-rule/50 pb-2.5">
          <button
            type="button"
            onClick={() => setActiveCategoryFilter("all")}
            className={`px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
              activeCategoryFilter === "all"
                ? "border-amber bg-amber/20 text-amber font-semibold"
                : "border-rule/60 text-dim hover:border-bone/60 hover:text-bone"
            }`}
          >
            All Leads ({allProfiles.length})
          </button>
          {availableCategories.map((cat) => {
            const count = allProfiles.filter((p) => p.categoryLabel === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategoryFilter(cat)}
                className={`px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
                  activeCategoryFilter === cat
                    ? "border-verdict bg-verdict/20 text-verdict font-semibold"
                    : "border-rule/60 text-dim hover:border-bone/60 hover:text-bone"
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Hub Detected Banner (Linktree / Beacons / Carrd) */}
      {bioHubsFound.length > 0 && (
        <div
          data-testid="hub-detected-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-verdict/40 bg-verdict/10 px-3 py-2 text-[11px]"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-verdict border border-verdict/60 px-1.5 py-0.5">
              1-Hop Bio-Hub Resolved
            </span>
            <span className="font-mono text-bone font-medium truncate max-w-[320px]">
              {bioHubsFound.join(", ")}
            </span>
          </div>
          <span className="font-mono text-[10px] text-verdict/80 uppercase">
            Crawled Underlying Social Graph
          </span>
        </div>
      )}

      {/* Discovered Profiles Sections */}
      <div className="mt-4 space-y-4">
        {loading && reports.length === 0 ? (
          <div className="py-6 text-center font-mono text-[11px] text-dim animate-pulse">
            [ RADAR ACTIVE ] Interrogating DOM, extracting post author & commenters, and following identity hubs…
          </div>
        ) : error ? (
          <div className="py-3 font-mono text-[11px] text-reject">
            Telemetry notice: {error} (target page restricted outbound scraping)
          </div>
        ) : filteredProfiles.length > 0 ? (
          <>
            {/* 1. Post Authors Section (e.g. Art Commisso / Chirag Bachwani) */}
            {authors.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-amber border border-amber/40 bg-amber/10 px-1.5 py-0.5">
                    Post Author / Publisher
                  </span>
                  <span className="font-mono text-[10px] text-dim">
                    Resolved directly from permalink & publisher actor
                  </span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {authors.map((p, idx) => (
                    <ProfileCard key={`author-${p.url}-${idx}`} profile={p} styleClass={platformStyle(p.platform, p.source)} />
                  ))}
                </div>
              </div>
            )}

            {/* 2. Commenters & Tagged Subjects Section (e.g. Bhavya Pratap Singh Tomar) */}
            {commenters.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-emerald-400 border border-emerald-500/40 bg-emerald-950/30 px-1.5 py-0.5">
                    Commenters & Tagged Subjects ({commenters.length})
                  </span>
                  <span className="font-mono text-[10px] text-dim">
                    Extracted from post thread, comments & tagged entities
                  </span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {commenters.map((p, idx) => (
                    <ProfileCard key={`commenter-${p.url}-${idx}`} profile={p} styleClass={platformStyle(p.platform, p.source)} />
                  ))}
                </div>
              </div>
            )}

            {/* 3. Outbound Profiles & Link-in-Bio Claims Section */}
            {outbounds.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-dim border border-rule/60 bg-black/40 px-1.5 py-0.5">
                    Outbound Claims & Bio-Hubs ({outbounds.length})
                  </span>
                  <span className="font-mono text-[10px] text-dim">
                    Published links & connected portfolios
                  </span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {outbounds.map((p, idx) => (
                    <ProfileCard key={`outbound-${p.url}-${idx}`} profile={p} styleClass={platformStyle(p.platform, p.source)} />
                  ))}
                </div>
              </div>
            )}
          </>
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

function ProfileCard({
  profile,
  styleClass,
}: {
  profile: DiscoveredProfile;
  styleClass: string;
}) {
  return (
    <a
      href={profile.url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={`intel-profile-${profile.platform}`}
      className={`group relative block border p-3 transition-all hover:scale-[1.01] hover:shadow-lg ${styleClass}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-bold uppercase tracking-widest opacity-90">
          {profile.platformName}
        </span>
        <span className="font-mono text-[8px] uppercase tracking-wider text-dim border border-rule/50 px-1 bg-black/50">
          {profile.roleLabel}
        </span>
      </div>

      <div className="mt-1.5 font-mono text-[12px] font-semibold text-bone group-hover:text-amber truncate">
        {profile.handle}
      </div>

      <div className="mt-1 font-mono text-[9px] text-dim truncate opacity-80">
        {profile.url.replace(/^https?:\/\//, "")}
      </div>

      {profile.categoryLabel && (
        <div className="mt-1 font-mono text-[8px] text-dim/90 truncate">
          Found via: {profile.categoryLabel}
        </div>
      )}
    </a>
  );
}
