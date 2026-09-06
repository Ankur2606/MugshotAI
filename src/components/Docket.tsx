"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Specimen, type Probe } from "./Specimen";
import { GateIntro } from "./GateIntro";
import { DepthField } from "./DepthField";
import { ScatterText } from "./ScatterText";
import { ConsoleButton } from "./ConsoleButton";
import { ThresholdDial } from "./ThresholdDial";
import { HashStrip } from "./HashStrip";
import { CalibrationScale } from "./CalibrationScale";
import { Station } from "./Station";
import { CandidateCarousel } from "./CandidateCarousel";
import { CyberIntelFootprint } from "./CyberIntelFootprint";
import {
  ENCODER_ID,
  imageFromDataUrl,
  passesQualityGate,
  readFace,
  scoreCandidateFace,
  resetEngineToProbeConfig,
} from "@/lib/human-client";
import {
  bundleDigest,
  canonicalJson,
  cosineSimilarityBp,
  descriptorDigest,
  type EvidenceBundle,
} from "@/lib/canonical";

type CandidateIn = {
  url: string;
  imageUrl: string;
  title: string;
  source: string;
  providerScoreBp?: number;
  probeCategory?: string;
  probeLabel?: string;
};

type Scored = CandidateIn & {
  key: string;
  phase: "queued" | "fetching" | "encoding" | "scored" | "skipped";
  similarityBp: number | null;
  imageSha256: string | null;
  thumb: string | null;
  note: string | null;
};

type Status = {
  search: {
    active: { id: string; label: string; configured: boolean } | null;
    providers: Array<{ id: string; label: string; configured: boolean }>;
  };
  chain: {
    label: string;
    chainId: number;
    registry: string | null;
    reachable: boolean;
    blockNumber: string | null;
    explorer: string;
    error: string | null;
  };
};

type Seal = {
  digest: string;
  txHash: string;
  blockNumber: string;
  gasUsed: string;
  contract: string;
  network: string;
  chainId: number;
  explorerUrl: string;
  anchoredAt: number;
  isExisting?: boolean;
  submitter?: string;
  similarityBp?: number;
};

type Verified = {
  digest: string;
  onChain: boolean;
  timestamp: number | null;
  submitter: string | null;
  similarityBp: number | null;
  verdict: string;
};

const CONCURRENCY = 3;

export function Docket() {
  const [status, setStatus] = useState<Status | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  // Calibrated against /selftest on the bundled faceres encoder: same-person
  // pairs landed at 57.7 and above, different-person pairs at 44.9 and below.
  // 54 sits in that gap. The operator can move it from the console.
  const [thresholdBp, setThresholdBp] = useState(5400);

  const [tracing, setTracing] = useState(false);
  const [traceMeta, setTraceMeta] = useState<{
    providerLabel: string;
    provider: string;
    probeImageSha256: string;
    elapsedMs: number;
    totalFound: number;
  } | null>(null);
  const [candidates, setCandidates] = useState<Scored[]>([]);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [activeFacet, setActiveFacet] = useState<string>("all");

  const [sealing, setSealing] = useState(false);
  const [seal, setSeal] = useState<Seal | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [tampered, setTampered] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const abortRef = useRef(false);

  const refreshStatus = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // The bench card should not lie: re-read it on an interval and after any
  // write, so the block number moves when the chain does.
  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 15000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  const scored = useMemo(
    () => candidates.filter((c) => c.similarityBp !== null),
    [candidates],
  );

  const best = useMemo(() => {
    const accepted = scored.filter((c) => (c.similarityBp as number) >= thresholdBp);
    if (accepted.length === 0) return null;
    if (selectedCandidateKey) {
      const manual = accepted.find((c) => c.key === selectedCandidateKey);
      if (manual) return manual;
    }
    return accepted.reduce((a, b) =>
      (b.similarityBp as number) > (a.similarityBp as number) ? b : a,
    );
  }, [scored, thresholdBp, selectedCandidateKey]);

  const bundle: EvidenceBundle | null = useMemo(() => {
    if (!probe || !best || !traceMeta || best.similarityBp === null || !best.imageSha256) {
      return null;
    }
    return {
      v: 1,
      probeImageSha256: traceMeta.probeImageSha256,
      probeDescriptorSha256: descriptorDigest(probe.reading.embedding),
      matchUrl: best.url,
      matchSource: best.source,
      matchTitle: best.title,
      matchImageSha256: best.imageSha256,
      similarityBp: best.similarityBp,
      encoder: ENCODER_ID,
      provider: traceMeta.provider,
    };
  }, [probe, best, traceMeta]);

  const digest = useMemo(() => (bundle ? bundleDigest(bundle) : null), [bundle]);

  /** The bundle we hand to /api/verify — optionally with one field edited. */
  const checkBundle: EvidenceBundle | null = useMemo(() => {
    if (!bundle) return null;
    if (!tampered) return bundle;
    return { ...bundle, similarityBp: Math.max(0, bundle.similarityBp - 1) };
  }, [bundle, tampered]);

  const checkDigest = useMemo(
    () => (checkBundle ? bundleDigest(checkBundle) : null),
    [checkBundle],
  );

  const resetDownstream = useCallback(() => {
    setTraceMeta(null);
    setCandidates([]);
    setSelectedCandidateKey(null);
    setActiveFacet("all");
    setTraceError(null);
    setSeal(null);
    setSealError(null);
    setVerified(null);
    setVerifyError(null);
    setTampered(false);
  }, []);

  const onProbe = useCallback(
    (p: Probe | null) => {
      abortRef.current = true;
      resetDownstream();
      void resetEngineToProbeConfig();
      setProbe(p);
    },
    [resetDownstream],
  );

  /** Fetch one candidate image and re-encode its face against the probe faces. */
  const scoreOne = useCallback(
    async (
      key: string,
      imageUrl: string,
      probeEmbeddings: number[][],
      probeCategory?: string,
    ) => {
      const patch = (p: Partial<Scored>) =>
        setCandidates((prev) => prev.map((c) => (c.key === key ? { ...c, ...p } : c)));

      patch({ phase: "fetching" });
      try {
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(imageUrl)}`);
        const json = await res.json();
        if (!res.ok) {
          patch({ phase: "skipped", note: json.error ?? "image unreachable" });
          return;
        }

        patch({ phase: "encoding", thumb: json.dataUrl, imageSha256: json.sha256 });
        const img = await imageFromDataUrl(json.dataUrl);
        const reading = await scoreCandidateFace(img);
        if (!reading) {
          patch({ phase: "skipped", note: "no face detected on this page image" });
          return;
        }
        // refuse to score a face too small or too uncertain to compare fairly
        const gate = passesQualityGate(reading);
        if (!gate.ok) {
          patch({ phase: "skipped", note: gate.reason });
          return;
        }

        let maxSim = 0;
        if (probeCategory && probeCategory.startsWith("face_")) {
          const faceIdx = parseInt(probeCategory.replace("face_", ""), 10);
          if (probeEmbeddings[faceIdx]) {
            maxSim = cosineSimilarityBp(probeEmbeddings[faceIdx], reading.embedding);
          }
        }
        if (maxSim === 0) {
          for (const emb of probeEmbeddings) {
            const sim = cosineSimilarityBp(emb, reading.embedding);
            if (sim > maxSim) maxSim = sim;
          }
        }

        patch({
          phase: "scored",
          similarityBp: maxSim,
        });
      } catch (e) {
        patch({
          phase: "skipped",
          note: e instanceof Error ? e.message : "could not be scored",
        });
      }
    },
    [],
  );

  const runTrace = useCallback(async () => {
    if (!probe) return;
    abortRef.current = false;
    resetDownstream();
    setTracing(true);

    try {
      const form = new FormData();
      form.append("image", probe.blob, "probe.jpg");

      // Multi-probe definitions: include scene + each detected face (top 4 to avoid excessive query fan-out)
      const probesList: Array<{ id: string; label: string; box?: [number, number, number, number]; boxRaw?: [number, number, number, number]; isPrimary?: boolean }> = [];
      if (probe.selectedFaceIndex === "all" && probe.allReadings && probe.allReadings.length > 0) {
        probe.allReadings.slice(0, 4).forEach((r, idx) => {
          probesList.push({
            id: `face_${idx}`,
            label: `Person ${idx + 1}`,
            box: r.box,
            boxRaw: r.boxRaw,
            isPrimary: false,
          });
        });
      } else if (typeof probe.selectedFaceIndex === "number" && probe.allReadings?.[probe.selectedFaceIndex]) {
        const target = probe.allReadings[probe.selectedFaceIndex];
        probesList.push({
          id: `face_${probe.selectedFaceIndex}`,
          label: `Person ${probe.selectedFaceIndex + 1}`,
          box: target.box,
          boxRaw: target.boxRaw,
          isPrimary: true,
        });
      } else if (probe.reading?.box) {
        probesList.push({
          id: "face_0",
          label: "Person 1",
          box: probe.reading.box,
          boxRaw: probe.reading.boxRaw,
          isPrimary: true,
        });
      }

      if (probesList.length > 0) {
        form.append("probes", JSON.stringify(probesList));
      }

      const res = await fetch("/api/search", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setTraceError(json.error ?? "The search backend returned an error.");
        return;
      }

      setTraceMeta({
        providerLabel: json.providerLabel,
        provider: json.provider,
        probeImageSha256: json.probeImageSha256,
        elapsedMs: json.elapsedMs,
        totalFound: json.totalFound,
      });

      const list: Scored[] = (json.candidates as CandidateIn[]).map((c, i) => ({
        ...c,
        key: `${i}-${c.url}`,
        phase: "queued" as const,
        similarityBp: null,
        imageSha256: null,
        thumb: null,
        note: null,
      }));
      setCandidates(list);

      if (list.length === 0) {
        setTraceError(
          "The search ran but returned no candidate pages. Try a clearer or better-known face.",
        );
        return;
      }

      const allEmbeddings =
        probe.allReadings && probe.allReadings.length > 0
          ? probe.allReadings.map((r) => r.embedding)
          : [probe.reading.embedding];

      // Small worker pool so the browser is not encoding 24 faces at once.
      const queue = [...list];
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0 && !abortRef.current) {
          const next = queue.shift();
          if (!next) break;
          await scoreOne(next.key, next.imageUrl, allEmbeddings, next.probeCategory);
        }
      });
      await Promise.all(workers);
    } catch (e) {
      setTraceError(e instanceof Error ? e.message : "The trace failed.");
    } finally {
      setTracing(false);
      void resetEngineToProbeConfig();
    }
  }, [probe, resetDownstream, scoreOne]);

  const runSeal = useCallback(async () => {
    if (!bundle) return;
    setSealing(true);
    setSealError(null);
    setVerified(null);
    try {
      const res = await fetch("/api/anchor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSealError(json.error ?? "Anchoring failed.");
        if (json.alreadyAnchored && json.existingRecord) {
          setSeal({
            digest: json.existingRecord.digest,
            txHash: json.existingRecord.txHash || "Previously Sealed (On-Chain)",
            blockNumber: json.existingRecord.blockNumber ? `#${json.existingRecord.blockNumber}` : "Historical",
            gasUsed: "— (pre-anchored)",
            contract: json.existingRecord.contract,
            network: json.existingRecord.network,
            chainId: json.existingRecord.chainId,
            explorerUrl: json.existingRecord.explorerUrl,
            anchoredAt: json.existingRecord.timestamp,
            isExisting: true,
            submitter: json.existingRecord.submitter,
            similarityBp: json.existingRecord.similarityBp,
          });
          refreshStatus();
        }
        return;
      }
      setSeal(json);
      refreshStatus();
    } catch (e) {
      setSealError(e instanceof Error ? e.message : "Anchoring failed.");
    } finally {
      setSealing(false);
    }
  }, [bundle, refreshStatus]);

  const runVerify = useCallback(async () => {
    if (!checkBundle) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle: checkBundle }),
      });
      const json = await res.json();
      if (!res.ok) {
        setVerifyError(json.error ?? "Verification failed.");
        return;
      }
      setVerified(json);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }, [checkBundle]);

  const searchReady = status?.search.active?.configured ?? false;
  const chainReady = Boolean(status?.chain.reachable && status?.chain.registry);

  const progress = candidates.length
    ? candidates.filter((c) => c.phase === "scored" || c.phase === "skipped").length
    : 0;

  const availableFacets = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) {
      set.add(c.probeCategory || "scene");
    }
    return Array.from(set).sort((a, b) => {
      if (a === "scene") return -1;
      if (b === "scene") return 1;
      return a.localeCompare(b);
    });
  }, [candidates]);

  const filteredCandidates = useMemo(() => {
    if (activeFacet === "all") return candidates;
    return candidates.filter((c) => (c.probeCategory || "scene") === activeFacet);
  }, [candidates, activeFacet]);

  return (
    <>
      <GateIntro />
      <DepthField />
      <div className="relative z-10 mx-auto w-full min-w-0 max-w-[1180px] overflow-x-clip px-6 pb-32 sm:px-10">
        <Masthead status={status} />

        <Station
          index="I"
          title="Specimen"
          caption="A face is captured and reduced to a numeric descriptor. Nothing leaves the browser at this stage."
          active
          done={Boolean(probe)}
        >
          <Specimen onProbe={onProbe} probe={probe} busy={tracing} />
        </Station>

        <Station
          index="II"
          title="Trace"
          caption={
            traceMeta
              ? `${traceMeta.providerLabel} returned ${traceMeta.totalFound} candidate pages in ${(traceMeta.elapsedMs / 1000).toFixed(1)}s. Each one is re-encoded here and scored against the specimen.`
              : "The probe goes out to a live image-search backend. Every page it returns is treated as a lead, not a match."
          }
          active={Boolean(probe)}
          done={scored.length > 0}
        >
          <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-6">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <ConsoleButton
                variant="primary"
                filled={tracing}
                onClick={() => void runTrace()}
                disabled={!probe || tracing || !searchReady}
                className="w-full sm:w-auto"
              >
                {tracing ? "Tracing…" : "Run trace"}
              </ConsoleButton>
              {!searchReady && (
                <span className="datum text-reject">
                  No search backend configured — set SERPAPI_API_KEY in .env.local
                </span>
              )}
              {candidates.length > 0 && (
                <span className="datum tabular-nums">
                  {progress}/{candidates.length} examined · {scored.length} carried a face
                </span>
              )}
            </div>

            <ThresholdDial valueBp={thresholdBp} onChange={setThresholdBp} />
          </div>

          {traceError && (
            <p className="mt-5 border-l-2 border-reject pl-3 text-[13px] text-bone">{traceError}</p>
          )}

          {/* Multi-Probe Facet Filter Tabs */}
          {candidates.length > 0 && availableFacets.length > 1 && (
            <div className="mt-6 flex flex-wrap items-center gap-1.5 border-b border-rule pb-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-dim mr-1">
                Filter Leads:
              </span>
              <button
                type="button"
                onClick={() => setActiveFacet("all")}
                className={`px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${activeFacet === "all"
                    ? "border-amber bg-amber/20 text-amber font-semibold"
                    : "border-rule text-dim hover:text-bone"
                  }`}
              >
                All Leads ({candidates.length})
              </button>
              {availableFacets.map((facet) => {
                const count = candidates.filter((c) => (c.probeCategory || "scene") === facet).length;
                const match = candidates.find((c) => (c.probeCategory || "scene") === facet);
                const label =
                  match?.probeLabel ||
                  (facet === "scene"
                    ? "Scene Context"
                    : facet.startsWith("face_")
                      ? `Person ${parseInt(facet.replace("face_", ""), 10) + 1}`
                      : facet);
                return (
                  <button
                    key={facet}
                    type="button"
                    onClick={() => setActiveFacet(facet)}
                    className={`px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${activeFacet === facet
                        ? "border-verdict bg-verdict/20 text-verdict font-semibold"
                        : "border-rule text-dim hover:text-bone"
                      }`}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {filteredCandidates.length > 0 && (
            <ul className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-2">
              {filteredCandidates.map((c, i) => (
                <CandidateRow
                  key={c.key}
                  c={c}
                  thresholdBp={thresholdBp}
                  isBest={best?.key === c.key}
                  index={i}
                />
              ))}
            </ul>
          )}
        </Station>

        <Station
          index="III"
          title="Adjudication"
          caption="One candidate clears the threshold and becomes the record. The rest stay on the docket with their scores, so the decision is inspectable."
          active={scored.length > 0}
          done={Boolean(bundle)}
        >
          {!bundle && scored.length > 0 && (
            <p className="max-w-xl text-[13px] leading-relaxed text-dim">
              Nothing cleared {(thresholdBp / 100).toFixed(0)}. The highest score was{" "}
              <span className="font-mono text-bone">
                {scored.length
                  ? (Math.max(...scored.map((s) => s.similarityBp as number)) / 100).toFixed(2)
                  : "—"}
              </span>
              . Lower the threshold to inspect near misses, or re-capture the specimen.
            </p>
          )}
          {!bundle && scored.length === 0 && (
            <p className="text-[13px] text-dim">Run the trace to populate this station.</p>
          )}

          {bundle && best && (
            <>
              <div className="grid w-full min-w-0 max-w-full gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div>
                  <span className="eyebrow">match of record</span>
                  <a
                    href={best.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2 block font-display text-[26px] leading-tight text-bone underline decoration-amber decoration-1 underline-offset-[6px] hover:text-amber"
                  >
                    {best.title}
                  </a>
                  <p className="datum mt-2">{best.url}</p>

                  <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                    <Fact label="similarity" value={((best.similarityBp as number) / 100).toFixed(2)} accent />
                    <Fact label="source" value={best.source} />
                    <Fact label="encoder" value="faceres 1024-d" />
                    <Fact label="found by" value={traceMeta?.providerLabel ?? "—"} />
                    <Fact label="candidates scored" value={String(scored.length)} />
                    <Fact
                      label="rejected"
                      value={String(scored.filter((s) => (s.similarityBp as number) < thresholdBp).length)}
                    />
                  </dl>

                  <Disclosure label="canonical bundle — the exact bytes that get hashed">
                    <pre className="hash mt-3 max-h-56 overflow-auto whitespace-pre-wrap border border-rule bg-bench p-4 text-dim">
                      {canonicalJson(bundle)}
                    </pre>
                  </Disclosure>
                </div>

                <div className="self-start border border-rule bg-bench p-5">
                  {best.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={best.thumb}
                      alt=""
                      className="mb-4 aspect-square w-full border border-rule object-cover"
                    />
                  )}
                  <HashStrip digest={digest} label="bundle digest · keccak256" />
                  <BundleMetadataInspector bundle={bundle} />
                </div>
              </div>

              {/* Cyber Intelligence Outbound Footprint Radar */}
              <CyberIntelFootprint targetUrl={best.url} />
            </>
          )}

          {/* Discovered Evidence 3D Carousel */}
          {scored.length > 0 && (
            <CandidateCarousel
              candidates={scored}
              thresholdBp={thresholdBp}
              selectedKey={best?.key ?? null}
              onSelect={(key) => setSelectedCandidateKey(key)}
            />
          )}
        </Station>

        <Station
          index="IV"
          title="Seal"
          caption="The digest goes on chain. The bundle itself does not — the chain only needs to prove the bundle has not changed since this moment."
          active={Boolean(bundle)}
          done={Boolean(seal)}
          last
        >
          <div className="flex flex-wrap items-center gap-3">
            <ConsoleButton
              variant="primary"
              filled={sealing || Boolean(seal)}
              onClick={() => void runSeal()}
              disabled={!bundle || sealing || !chainReady || Boolean(seal)}
              className="w-full sm:w-auto"
            >
              {sealing ? "Writing…" : seal?.isExisting ? "Already Sealed" : seal ? "Sealed" : "Seal to chain"}
            </ConsoleButton>
            {!chainReady && (
              <span className="datum text-reject">
                {status?.chain.registry
                  ? `Chain unreachable at ${status.chain.label}`
                  : "No registry deployed — run npm run chain:node then npm run chain:deploy"}
              </span>
            )}
          </div>

          {sealError && (
            <p
              className={`mt-5 border-l-2 pl-3 text-[13px] text-bone ${seal?.isExisting ? "border-amber" : "border-reject"
                }`}
            >
              {seal?.isExisting && (
                <span className="mr-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber">
                  Notice:
                </span>
              )}
              {sealError}
            </p>
          )}

          <AnimatePresence>
            {seal && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="mt-7 border border-rule bg-bench"
              >
                <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                  <span className="eyebrow flex items-center gap-2">
                    {seal.isExisting ? "previously sealed on-chain record" : "on-chain receipt"}
                    {seal.isExisting && (
                      <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber">
                        Pre-anchored
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-verdict">
                    {seal.network} · chain {seal.chainId}
                  </span>
                </div>
                <dl className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
                  <Fact label="digest (sealed id)" value={seal.digest} mono wrap accent />
                  <Fact label="transaction" value={seal.txHash} mono wrap />
                  <Fact label="contract" value={seal.contract} mono wrap />
                  <Fact label="block" value={seal.blockNumber} mono />
                  {seal.submitter && <Fact label="submitter" value={seal.submitter} mono wrap />}
                  {seal.anchoredAt ? (
                    <Fact
                      label="sealed at"
                      value={new Date(seal.anchoredAt * 1000).toISOString().replace(".000Z", " UTC")}
                      mono
                    />
                  ) : null}
                  {seal.similarityBp !== undefined ? (
                    <Fact
                      label="on-chain similarity"
                      value={`${(seal.similarityBp / 100).toFixed(2)}% (${seal.similarityBp} bp)`}
                      mono
                    />
                  ) : (
                    <Fact label="gas used" value={seal.gasUsed} mono />
                  )}
                </dl>
                {seal.explorerUrl && (
                  <a
                    href={seal.explorerUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block border-t border-rule px-5 py-3 font-mono text-[11px] uppercase tracking-widest text-amber hover:bg-amber hover:text-ink transition-colors"
                  >
                    {seal.network.includes("Sepolia")
                      ? "Open on Etherscan (Sepolia) ↗"
                      : seal.network.includes("Amoy")
                        ? "Open on Polygonscan (Amoy) ↗"
                        : "Open in block explorer ↗"}
                  </a>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {seal && (
            <div className="mt-10 border-t border-rule pt-7">
              <span className="eyebrow">re-verification</span>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-dim">
                Hash the bundle again and ask the chain whether it has seen that digest. Flip the
                switch to alter one field first: the digest changes, and the record no longer
                matches. That is what tamper-evident means here.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <ConsoleButton
                  variant="quiet"
                  onClick={() => void runVerify()}
                  disabled={verifying}
                  className="w-full sm:w-auto"
                >
                  {verifying ? "Checking…" : "Re-verify against chain"}
                </ConsoleButton>

                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={tampered}
                    onChange={(e) => {
                      setTampered(e.target.checked);
                      setVerified(null);
                    }}
                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--reject)]"
                  />
                  <span className="font-mono text-[11px] uppercase tracking-widest text-dim">
                    Alter the bundle first
                  </span>
                </label>
              </div>

              <div className="mt-6 grid gap-8 sm:grid-cols-2">
                <HashStrip digest={seal.digest} tone="dim" label="sealed digest" />
                <HashStrip
                  digest={checkDigest}
                  tone={tampered ? "reject" : "verdict"}
                  label={tampered ? "recomputed after edit" : "recomputed now"}
                />
              </div>

              {verifyError && (
                <p className="mt-5 border-l-2 border-reject pl-3 text-[13px] text-bone">
                  {verifyError}
                </p>
              )}

              <AnimatePresence mode="wait">
                {verified && (
                  <motion.div
                    key={String(verified.onChain) + verified.digest}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mt-7 border-l-2 pl-5"
                    style={{
                      borderColor: verified.onChain ? "var(--verdict)" : "var(--reject)",
                    }}
                  >
                    <p
                      className="font-display text-[30px] leading-none"
                      style={{ color: verified.onChain ? "var(--verdict)" : "var(--reject)" }}
                    >
                      {verified.onChain ? "Intact" : "Not on chain"}
                    </p>
                    <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-dim">
                      {verified.verdict}
                    </p>
                    {verified.onChain && verified.timestamp && (
                      <p className="datum mt-3">
                        sealed {new Date(verified.timestamp * 1000).toISOString()} by{" "}
                        {verified.submitter} · similarity{" "}
                        {((verified.similarityBp ?? 0) / 100).toFixed(2)}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </Station>

        <footer className="mt-4 border-t border-rule pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <span className="font-display text-[15px] tracking-[-0.01em] text-dim">
              Facechain <span className="text-faint">— evidence console</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              faceres 1024-d · keccak-256 · {status?.chain.label ?? "no chain"} · hh goa 2026
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}

/**
 * Bundle Metadata Inspector: Forensic breakdown of all 10 key-value pairs
 * that compose the canonical evidence bundle before Keccak-256 hashing.
 */
function BundleMetadataInspector({ bundle }: { bundle: EvidenceBundle }) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"kv" | "json">("kv");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyValue = useCallback((text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  }, []);

  const fields: Array<{
    key: keyof EvidenceBundle;
    label: string;
    description: string;
    value: string;
    isUrl?: boolean;
  }> = [
      {
        key: "probeImageSha256",
        label: "probeImageSha256",
        description: "SHA-256 of probe JPEG bytes",
        value: bundle.probeImageSha256,
      },
      {
        key: "probeDescriptorSha256",
        label: "probeDescriptorSha256",
        description: "Quantized probe 1024-d face embedding hash",
        value: bundle.probeDescriptorSha256,
      },
      {
        key: "matchImageSha256",
        label: "matchImageSha256",
        description: "SHA-256 of candidate matched image bytes",
        value: bundle.matchImageSha256,
      },
      {
        key: "matchUrl",
        label: "matchUrl",
        description: "Public web URL of matched finding",
        value: bundle.matchUrl,
        isUrl: true,
      },
      {
        key: "matchSource",
        label: "matchSource",
        description: "Matched domain host",
        value: bundle.matchSource,
      },
      {
        key: "matchTitle",
        label: "matchTitle",
        description: "Matched post or page title",
        value: bundle.matchTitle,
      },
      {
        key: "similarityBp",
        label: "similarityBp",
        description: "Cosine face similarity (basis points / %)",
        value: `${bundle.similarityBp} bp (${(bundle.similarityBp / 100).toFixed(2)}%)`,
      },
      {
        key: "encoder",
        label: "encoder",
        description: "Face descriptor model",
        value: bundle.encoder,
      },
      {
        key: "provider",
        label: "provider",
        description: "Visual search backend provider",
        value: bundle.provider,
      },
      {
        key: "v",
        label: "v",
        description: "Evidence bundle schema version",
        value: String(bundle.v),
      },
    ];

  return (
    <div className="mt-4 border-t border-rule pt-3.5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group flex w-full items-center justify-between gap-2 text-left transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-bone group-hover:text-amber">
          <motion.span
            aria-hidden
            className="inline-block text-[10px] text-amber"
            initial={false}
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            ▸
          </motion.span>
          Bundle Metadata Inspector
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-dim">
          {open ? "hide" : "10 keys · inspect"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 border border-rule bg-ink/70 p-3">
              <div className="flex items-center justify-between border-b border-rule pb-2">
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <button
                    type="button"
                    onClick={() => setViewMode("kv")}
                    className={`px-2 py-0.5 uppercase tracking-wider transition-colors ${viewMode === "kv"
                        ? "bg-bench-hi text-amber border border-rule-hi"
                        : "text-dim hover:text-bone"
                      }`}
                  >
                    Key-Value
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("json")}
                    className={`px-2 py-0.5 uppercase tracking-wider transition-colors ${viewMode === "json"
                        ? "bg-bench-hi text-amber border border-rule-hi"
                        : "text-dim hover:text-bone"
                      }`}
                  >
                    Raw JSON
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue(canonicalJson(bundle), "all-json")}
                  className="font-mono text-[10px] uppercase tracking-wider text-dim hover:text-amber transition-colors"
                >
                  {copiedKey === "all-json" ? "✓ Copied" : "Copy Payload"}
                </button>
              </div>

              {viewMode === "kv" ? (
                <div className="mt-2.5 max-h-80 space-y-2.5 overflow-y-auto pr-1">
                  {fields.map((f) => (
                    <div
                      key={f.key}
                      className="border-b border-rule/60 pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[10px] text-amber font-medium">
                          {f.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyValue(String(bundle[f.key]), f.key)}
                          className="font-mono text-[9px] uppercase tracking-wider text-dim hover:text-bone transition-colors"
                          title={`Copy ${f.label}`}
                        >
                          {copiedKey === f.key ? (
                            <span className="text-verdict font-semibold">✓ Copied</span>
                          ) : (
                            "Copy"
                          )}
                        </button>
                      </div>
                      <p className="font-mono text-[9px] text-dim">{f.description}</p>
                      <div className="mt-1">
                        {f.isUrl ? (
                          <a
                            href={f.value}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-mono text-[11px] text-bone break-all underline decoration-rule-hi underline-offset-2 hover:text-amber"
                          >
                            {f.value}
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-bone break-all select-all">
                            {f.value}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2.5">
                  <pre className="hash max-h-80 overflow-auto whitespace-pre-wrap border border-rule/80 bg-bench/80 p-2.5 text-[10px] text-dim select-all">
                    {canonicalJson(bundle)}
                  </pre>
                </div>
              )}

              <div className="mt-3 border-t border-rule/70 pt-2 text-[10px] text-dim leading-normal">
                <span className="text-amber mr-1">✦</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-dim">
                  Strictly Content-Derived:
                </span>{" "}
                Every byte hashed is deterministic. Temporal proof is established by Ethereum{" "}
                <code className="font-mono text-[9px] text-bone">block.timestamp</code>.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A disclosure that folds like the evidence sleeve it is: the caret is a
 * rotated corner bracket, the height animates, and the open state is real
 * layout, not display toggling.
 */
function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [openState, setOpenState] = useState(false);
  return (
    <div className="mt-7 border-t border-rule pt-4">
      <button
        onClick={() => setOpenState((v) => !v)}
        aria-expanded={openState}
        className="eyebrow flex w-full items-center gap-2.5 text-left transition-colors hover:text-amber focus-visible:text-amber"
      >
        <motion.span
          aria-hidden
          className="inline-block font-mono text-[10px]"
          initial={false}
          animate={{ rotate: openState ? 90 : 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          ▸
        </motion.span>
        {label}
      </button>
      <AnimatePresence initial={false}>
        {openState && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CandidateRow({
  c,
  thresholdBp,
  isBest,
  index,
}: {
  c: Scored;
  thresholdBp: number;
  isBest: boolean;
  index: number;
}) {
  const state: "accepted" | "rejected" | "pending" | "failed" =
    c.phase === "skipped"
      ? "failed"
      : c.similarityBp === null
        ? "pending"
        : c.similarityBp >= thresholdBp
          ? "accepted"
          : "rejected";

  return (
    <motion.li
      className="group relative bg-ink p-4"
      style={{ background: isBest ? "var(--bench-hi)" : undefined }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.6), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ backgroundColor: isBest ? undefined : "rgba(26,31,38,0.85)" }}
    >
      {isBest && <span className="absolute inset-y-0 left-0 w-[2px] bg-verdict" />}
      {/* voided evidence: skipped candidates get the archivist's hatching */}
      {c.phase === "skipped" && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent 0 7px, rgba(76,85,94,0.14) 7px 8px)",
          }}
        />
      )}
      <div className="flex gap-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden border border-rule bg-bench">
          {c.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full animate-pulse bg-bench-hi" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate text-[13px] text-bone hover:text-amber"
              title={c.title}
            >
              {c.title}
            </a>
            <span
              className="shrink-0 font-mono text-[13px] tabular-nums"
              style={{
                color:
                  state === "accepted"
                    ? "var(--verdict)"
                    : state === "rejected"
                      ? "var(--reject)"
                      : "var(--faint)",
              }}
            >
              {c.similarityBp !== null ? (c.similarityBp / 100).toFixed(2) : "··"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="datum truncate">{c.source}</p>
            <span
              className={`shrink-0 border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                c.probeCategory?.startsWith("face_")
                  ? "border-verdict/60 bg-verdict/10 text-verdict font-semibold"
                  : "border-rule/60 bg-bench/60 text-dim"
              }`}
            >
              {c.probeLabel ||
                (c.probeCategory?.startsWith("face_")
                  ? `Person ${parseInt(c.probeCategory.replace("face_", ""), 10) + 1}`
                  : "Scene Context")}
            </span>
          </div>

          <div className="mt-2.5">
            <CalibrationScale
              valueBp={c.similarityBp}
              thresholdBp={thresholdBp}
              state={state}
              pending={c.phase === "fetching" || c.phase === "encoding"}
            />
          </div>

          <p className="eyebrow mt-1.5">
            {c.phase === "queued" && "queued"}
            {c.phase === "fetching" && "fetching image"}
            {c.phase === "encoding" && "encoding face"}
            {c.phase === "skipped" && (c.note ?? "skipped")}
            {c.phase === "scored" && (state === "accepted" ? "accepted" : "below threshold")}
          </p>
        </div>
      </div>
    </motion.li>
  );
}

function Fact({
  label,
  value,
  mono,
  wrap,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="border-t border-rule pt-2">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 text-[13px] ${mono || accent ? "font-mono" : ""} ${wrap ? "break-all" : "truncate"}`}
        style={{ color: accent ? "var(--amber)" : "var(--bone)" }}
      >
        {value}
      </dd>
    </div>
  );
}

function Masthead({ status }: { status: Status | null }) {
  const search = status?.search.active;
  const chain = status?.chain;
  return (
    <header className="border-b border-rule py-12 sm:py-16">
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_300px] lg:gap-16">
        <div className="min-w-0">
          <span className="flex items-center gap-4">
            <span className="h-px w-8 shrink-0 bg-rule-hi" aria-hidden />
            <span className="eyebrow whitespace-nowrap">face → post → chain</span>
            <span className="h-px flex-1 bg-rule" aria-hidden />
          </span>
          <h1 className="mt-5 font-display text-[clamp(44px,9vw,86px)] font-normal leading-[0.92] tracking-[-0.02em]">
            <ScatterText text="Facechain" />
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-dim">
            A face is scanned, traced to where it appears on the public web, and the finding is
            sealed to a blockchain. Every candidate is re-encoded and scored here before anything
            is called a match.
          </p>

          {/* the dossier line: what instrument, what digest, whose custody */}
          <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            <div className="flex gap-2">
              <dt>encoder</dt>
              <dd className="text-dim">faceres · 1024-d</dd>
            </div>
            <div className="flex gap-2">
              <dt>digest</dt>
              <dd className="text-dim">keccak-256</dd>
            </div>
            <div className="flex gap-2">
              <dt>probe</dt>
              <dd className="text-dim">never leaves this browser unhashed</dd>
            </div>
          </dl>
        </div>

        <BenchCard search={search} chain={chain} />
      </div>
    </header>
  );
}

/**
 * The instrument panel: is each half of the pipeline actually live right now.
 * It re-reads itself every fifteen seconds, so the block number is a fact,
 * not a decoration.
 */
function BenchCard({
  search,
  chain,
}: {
  search: Status["search"]["active"] | undefined;
  chain: Status["chain"] | undefined;
}) {
  const allOk = Boolean(search?.configured && chain?.reachable && chain?.registry);
  return (
    <motion.aside
      className="border border-rule bg-bench"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="eyebrow">bench status</span>
        <motion.span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: allOk ? "var(--verdict)" : "var(--amber)" }}
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <dl>
        <BenchRow
          label="search"
          value={search ? search.label : "not configured"}
          ok={Boolean(search?.configured)}
        />
        <BenchRow
          label="chain"
          value={chain ? chain.label : "checking"}
          ok={Boolean(chain?.reachable)}
        />
        <BenchRow
          label="registry"
          value={
            chain?.registry
              ? `${chain.registry.slice(0, 8)}…${chain.registry.slice(-4)}`
              : "not deployed"
          }
          ok={Boolean(chain?.registry)}
        />
      </dl>
      <div className="flex items-baseline justify-between border-t border-rule px-4 py-2.5">
        <span className="eyebrow">block</span>
        <span className="font-mono text-[12px] tabular-nums text-dim">
          {chain?.blockNumber ?? "—"}
        </span>
      </div>
    </motion.aside>
  );
}

function BenchRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: ok ? "var(--verdict)" : "var(--reject)" }}
      />
      <dt className="eyebrow w-14 shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[11px] text-dim" style={{ marginLeft: "auto" }}>
        {value}
      </dd>
    </div>
  );
}
