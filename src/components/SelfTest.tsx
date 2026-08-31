"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cosineSimilarityBp } from "@/lib/canonical";
import { imageFromDataUrl, readFace } from "@/lib/human-client";
import { ConsoleButton } from "./ConsoleButton";

/**
 * Checks the face half of the pipeline without spending a search credit.
 *
 * Four public-domain portraits go through the proxy route and the same encoder
 * the console uses. Two are the same person, two are other people. The test
 * passes when every same-person pair scores above every different-person pair,
 * which is the only property the adjudication step depends on.
 */

type Subject = { id: string; person: string; url: string };

const SUBJECTS: Subject[] = [
  {
    id: "obama-a",
    person: "Obama",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/500px-President_Barack_Obama.jpg",
  },
  {
    id: "obama-b",
    person: "Obama",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Obama_Portrait_2006.jpg/500px-Obama_Portrait_2006.jpg",
  },
  {
    id: "merkel",
    person: "Merkel",
    url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/Angela_Merkel_2019_cropped.jpg",
  },
  {
    id: "watson",
    person: "Watson",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/7f/Emma_Watson_2013.jpg",
  },
];

type Encoded = Subject & { embedding: number[]; sha256: string; thumb: string };
type Pair = { a: string; b: string; same: boolean; bp: number };

export function SelfTest() {
  const reduced = useReducedMotion();
  const [log, setLog] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [verdict, setVerdict] = useState<"pass" | "fail" | null>(null);
  const [running, setRunning] = useState(false);

  const say = (line: string) => setLog((l) => [...l, line]);

  const run = useCallback(async () => {
    setRunning(true);
    setLog([]);
    setPairs([]);
    setVerdict(null);

    const encoded: Encoded[] = [];
    for (const s of SUBJECTS) {
      say(`fetching ${s.id}`);
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(s.url)}`);
      const json = await res.json();
      if (!res.ok) {
        say(`  FAILED: ${json.error}`);
        continue;
      }
      say(`  ${json.bytes} bytes, sha256 ${json.sha256.slice(0, 18)}…`);

      const img = await imageFromDataUrl(json.dataUrl);
      const reading = await readFace(img);
      if (!reading) {
        say(`  FAILED: no face detected`);
        continue;
      }
      say(
        `  encoded: ${reading.embedding.length}-d, detector ${(reading.score * 100).toFixed(1)}%`,
      );
      encoded.push({ ...s, embedding: reading.embedding, sha256: json.sha256, thumb: json.dataUrl });
    }

    if (encoded.length < 3) {
      say("Not enough faces encoded to compare.");
      setVerdict("fail");
      setRunning(false);
      return;
    }

    const out: Pair[] = [];
    for (let i = 0; i < encoded.length; i++) {
      for (let j = i + 1; j < encoded.length; j++) {
        out.push({
          a: encoded[i].id,
          b: encoded[j].id,
          same: encoded[i].person === encoded[j].person,
          bp: cosineSimilarityBp(encoded[i].embedding, encoded[j].embedding),
        });
      }
    }
    out.sort((x, y) => y.bp - x.bp);
    setPairs(out);

    const same = out.filter((p) => p.same);
    const diff = out.filter((p) => !p.same);
    const worstSame = Math.min(...same.map((p) => p.bp));
    const bestDiff = Math.max(...diff.map((p) => p.bp));

    say("");
    say(`lowest same-person pair:      ${(worstSame / 100).toFixed(2)}`);
    say(`highest different-person pair: ${(bestDiff / 100).toFixed(2)}`);
    const pass = same.length > 0 && worstSame > bestDiff;
    say(pass ? "PASS — the encoder separates identities." : "FAIL — scores overlap.");
    setVerdict(pass ? "pass" : "fail");
    setRunning(false);
  }, []);

  return (
    <div className="mx-auto max-w-[900px] px-6 py-16 sm:px-10">
      <span className="eyebrow">diagnostic</span>
      <h1 className="mt-3 font-display text-[42px] leading-none">Encoder self-test</h1>
      <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-dim">
        Four public-domain portraits, two of them the same person, through the proxy and the
        encoder the console uses. It passes when same-person pairs outscore every
        different-person pair. No search key needed.
      </p>

      {/* filled while running instead of disabled-grey, so the busy state
          reads as work in progress; the click guard prevents double runs */}
      <ConsoleButton
        variant="primary"
        filled={running}
        onClick={() => {
          if (!running) void run();
        }}
        aria-busy={running}
        className="mt-8"
      >
        {running ? "Running…" : "Run self-test"}
      </ConsoleButton>

      {verdict && (
        <p
          className="mt-8 font-display text-[34px] leading-none"
          style={{ color: verdict === "pass" ? "var(--verdict)" : "var(--reject)" }}
        >
          {verdict === "pass" ? "Pass" : "Fail"}
        </p>
      )}

      {pairs.length > 0 && (
        // the table must scroll, not shear, on a 390px screen
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr>
              <th className="eyebrow border-b border-rule pb-2">pair</th>
              <th className="eyebrow border-b border-rule pb-2">expected</th>
              <th className="eyebrow border-b border-rule pb-2 text-right">similarity</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <motion.tr
                key={`${p.a}-${p.b}`}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.04, ease: "easeOut" }}
              >
                <td className="border-b border-rule py-2 font-mono text-[12px] text-bone">
                  {p.a} ↔ {p.b}
                </td>
                <td className="border-b border-rule py-2 font-mono text-[12px] text-dim">
                  {p.same ? "same person" : "different"}
                </td>
                <td
                  className="border-b border-rule py-2 text-right font-mono text-[13px] tabular-nums"
                  style={{ color: p.same ? "var(--verdict)" : "var(--reject)" }}
                >
                  {(p.bp / 100).toFixed(2)}
                </td>
              </motion.tr>
            ))}
          </tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <pre className="hash mt-8 max-h-80 overflow-auto whitespace-pre-wrap border border-rule bg-bench p-4 text-dim">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}
