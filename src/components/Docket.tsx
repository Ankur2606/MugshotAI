"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Specimen, type Probe } from "./Specimen";
import { GateIntro } from "./GateIntro";
import { DepthField } from "./DepthField";
import { ScatterText } from "./ScatterText";
import { HashStrip } from "./HashStrip";
import { CalibrationScale } from "./CalibrationScale";
import { Station } from "./Station";
import {
  ENCODER_ID,
  imageFromDataUrl,
  readFace,
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

  const [sealing, setSealing] = useState(false);
  const [seal, setSeal] = useState<Seal | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [tampered, setTampered] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const abortRef = useRef(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const scored = useMemo(
    () => candidates.filter((c) => c.similarityBp !== null),
    [candidates],
  );

  const best = useMemo(() => {
    const accepted = scored.filter((c) => (c.similarityBp as number) >= thresholdBp);
    if (accepted.length === 0) return null;
    return accepted.reduce((a, b) =>
      (b.similarityBp as number) > (a.similarityBp as number) ? b : a,
    );
  }, [scored, thresholdBp]);

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
      capturedAt: probe.capturedAt,
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
      setProbe(p);
    },
    [resetDownstream],
  );

  /** Fetch one candidate image and re-encode its face against the probe. */
  const scoreOne = useCallback(
    async (key: string, imageUrl: string, probeEmbedding: number[]) => {
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
        const reading = await readFace(img);
        if (!reading) {
          patch({ phase: "skipped", note: "no face detected on this page image" });
          return;
        }
        patch({
          phase: "scored",
          similarityBp: cosineSimilarityBp(probeEmbedding, reading.embedding),
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

      // Small worker pool so the browser is not encoding 24 faces at once.
      const queue = [...list];
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0 && !abortRef.current) {
          const next = queue.shift();
          if (!next) break;
          await scoreOne(next.key, next.imageUrl, probe.reading.embedding);
        }
      });
      await Promise.all(workers);
    } catch (e) {
      setTraceError(e instanceof Error ? e.message : "The trace failed.");
    } finally {
      setTracing(false);
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
        return;
      }
      setSeal(json);
    } catch (e) {
      setSealError(e instanceof Error ? e.message : "Anchoring failed.");
    } finally {
      setSealing(false);
    }
  }, [bundle]);

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

  return (
    <>
      <GateIntro />
      <DepthField />
      <div className="relative z-10 mx-auto max-w-[1180px] px-6 pb-32 sm:px-10">
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
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void runTrace()}
              disabled={!probe || tracing || !searchReady}
              className="border border-amber bg-amber px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-ink transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-faint"
            >
              {tracing ? "Tracing…" : "Run trace"}
            </button>
            {!searchReady && (
              <span className="datum text-reject">
                No search backend configured — set SERPAPI_API_KEY in .env.local
              </span>
            )}
            {candidates.length > 0 && (
              <span className="datum">
                {progress}/{candidates.length} examined · {scored.length} carried a face
              </span>
            )}
          </div>

          <label className="flex items-center gap-3">
            <span className="eyebrow">accept at</span>
            <input
              type="range"
              min={2000}
              max={9000}
              step={100}
              value={thresholdBp}
              onChange={(e) => setThresholdBp(Number(e.target.value))}
              className="h-1 w-40 cursor-pointer appearance-none bg-rule accent-[var(--amber)]"
            />
            <span className="font-mono text-[13px] text-amber">
              {(thresholdBp / 100).toFixed(0)}
            </span>
          </label>
        </div>

        {traceError && (
          <p className="mt-5 border-l-2 border-reject pl-3 text-[13px] text-bone">{traceError}</p>
        )}

        {candidates.length > 0 && (
          <ul className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-2">
            {candidates.map((c) => (
              <CandidateRow
                key={c.key}
                c={c}
                thresholdBp={thresholdBp}
                isBest={best?.key === c.key}
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
          <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
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

              <details className="mt-7 border-t border-rule pt-4">
                <summary className="eyebrow cursor-pointer hover:text-amber">
                  canonical bundle — the exact bytes that get hashed
                </summary>
                <pre className="hash mt-3 max-h-56 overflow-auto whitespace-pre-wrap bg-bench p-4 text-dim">
                  {canonicalJson(bundle)}
                </pre>
              </details>
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
            </div>
          </div>
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
          <button
            onClick={() => void runSeal()}
            disabled={!bundle || sealing || !chainReady || Boolean(seal)}
            className="border border-amber bg-amber px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-ink transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-faint"
          >
            {sealing ? "Writing…" : seal ? "Sealed" : "Seal to chain"}
          </button>
          {!chainReady && (
            <span className="datum text-reject">
              {status?.chain.registry
                ? `Chain unreachable at ${status.chain.label}`
                : "No registry deployed — run npm run chain:node then npm run chain:deploy"}
            </span>
          )}
        </div>

        {sealError && (
          <p className="mt-5 border-l-2 border-reject pl-3 text-[13px] text-bone">{sealError}</p>
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
                <span className="eyebrow">on-chain receipt</span>
                <span className="font-mono text-[11px] text-verdict">
                  {seal.network} · chain {seal.chainId}
                </span>
              </div>
              <dl className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
                <Fact label="transaction" value={seal.txHash} mono wrap />
                <Fact label="contract" value={seal.contract} mono wrap />
                <Fact label="block" value={seal.blockNumber} mono />
                <Fact label="gas used" value={seal.gasUsed} mono />
              </dl>
              {seal.explorerUrl && (
                <a
                  href={seal.explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block border-t border-rule px-5 py-3 font-mono text-[11px] uppercase tracking-widest text-amber hover:bg-amber hover:text-ink"
                >
                  Open on Polygonscan ↗
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
              <button
                onClick={() => void runVerify()}
                disabled={verifying}
                className="border border-bone px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-bone transition-colors hover:bg-bone hover:text-ink disabled:cursor-not-allowed disabled:border-rule disabled:text-faint"
              >
                {verifying ? "Checking…" : "Re-verify against chain"}
              </button>

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
      </div>
    </>
  );
}

function CandidateRow({
  c,
  thresholdBp,
  isBest,
}: {
  c: Scored;
  thresholdBp: number;
  isBest: boolean;
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
    <li
      className="relative bg-ink p-4 transition-colors"
      style={{ background: isBest ? "var(--bench-hi)" : undefined }}
    >
      {isBest && <span className="absolute inset-y-0 left-0 w-[2px] bg-verdict" />}
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
          <p className="datum mt-0.5 truncate">{c.source}</p>

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
    </li>
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
    <header className="border-b border-rule py-16">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div>
          <span className="eyebrow">face → post → chain</span>
          <h1 className="mt-4 font-display text-[clamp(44px,7vw,86px)] font-normal leading-[0.92] tracking-[-0.02em]">
            <ScatterText text="Facechain" />
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-dim">
            A face is scanned, traced to where it appears on the public web, and the finding is
            sealed to a blockchain. Every candidate is re-encoded and scored here before anything
            is called a match.
          </p>
        </div>

        <dl className="grid min-w-[240px] gap-3">
          <StatusLine
            label="search"
            value={search ? search.label : "not configured"}
            ok={Boolean(search?.configured)}
          />
          <StatusLine
            label="chain"
            value={chain ? `${chain.label} · block ${chain.blockNumber ?? "—"}` : "checking"}
            ok={Boolean(chain?.reachable)}
          />
          <StatusLine
            label="registry"
            value={chain?.registry ? `${chain.registry.slice(0, 10)}…${chain.registry.slice(-6)}` : "not deployed"}
            ok={Boolean(chain?.registry)}
          />
        </dl>
      </div>
    </header>
  );
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-3 border-t border-rule pt-2">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: ok ? "var(--verdict)" : "var(--reject)" }}
      />
      <span className="eyebrow w-16">{label}</span>
      <span className="font-mono text-[11px] text-dim">{value}</span>
    </div>
  );
}
