// Research benchmark: runs the labelled cases in benchmarks/research-gates.json through the
// research engine's code checks and reports precision and recall per check.
// Usage: npm run bench   (exit code 1 when any check is below its threshold)

import { readFileSync } from "node:fs";
import { blockerSupported, claimFidelity, companyMarks, explicitIntent, independentReports, reportFingerprint } from "../src/lib/pipeline/gates";

interface Score { tp: number; fp: number; tn: number; fn: number; misses: string[] }
const blank = (): Score => ({ tp: 0, fp: 0, tn: 0, fn: 0, misses: [] });
const tally = (s: Score, got: boolean, expect: boolean, label: string) => {
  if (got && expect) s.tp++;
  else if (got && !expect) (s.fp++, s.misses.push(`false positive: ${label}`));
  else if (!got && expect) (s.fn++, s.misses.push(`missed: ${label}`));
  else s.tn++;
};

export function runBench(file = new URL("../benchmarks/research-gates.json", import.meta.url)) {
  const b = JSON.parse(readFileSync(file, "utf8"));
  const out: Record<string, Score> = { blocker: blank(), fidelity: blank(), explicitIntent: blank(), syndication: blank() };
  for (const c of b.blocker) tally(out.blocker, blockerSupported(c.kind, c.quote, c.company, null), c.expect, `${c.kind}: ${c.quote}`);
  for (const c of b.fidelity) tally(out.fidelity, claimFidelity(c.claim, c.quote, companyMarks(c.company, null), c.quote).pass, c.expect, `${c.claim} ⟵ ${c.quote}`);
  for (const c of b.explicitIntent) tally(out.explicitIntent, explicitIntent(c.quote), c.expect, c.quote);
  for (const c of b.syndication) {
    const n = independentReports(c.quotes.map((q: string, i: number) => ({ sourceUrl: `https://${c.hosts[i]}/x`, fingerprint: reportFingerprint(q) })));
    tally(out.syndication, n === c.expectReports, true, `${c.quotes.length} sources → ${n} report(s), expected ${c.expectReports}`);
  }
  return Object.fromEntries(Object.entries(out).map(([k, s]) => {
    const precision = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 1;
    const recall = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1;
    const accuracy = (s.tp + s.tn) / Math.max(1, s.tp + s.tn + s.fp + s.fn);
    return [k, { precision, recall, accuracy, cases: s.tp + s.tn + s.fp + s.fn, misses: s.misses }];
  }));
}

/** Below this, the benchmark fails: the architecture's 90–98% target, checked on labelled cases. */
export const THRESHOLD = 0.9;

if (process.argv[1]?.endsWith("bench.ts")) {
  const r = runBench();
  let ok = true;
  for (const [k, v] of Object.entries(r)) {
    const pass = v.precision >= THRESHOLD && v.recall >= THRESHOLD;
    ok &&= pass;
    console.log(`${pass ? "✓" : "✗"} ${k.padEnd(15)} precision ${(v.precision * 100).toFixed(0)}%  recall ${(v.recall * 100).toFixed(0)}%  accuracy ${(v.accuracy * 100).toFixed(0)}%  (${v.cases} cases)`);
    for (const m of v.misses) console.log(`    ${m}`);
  }
  process.exit(ok ? 0 : 1);
}
