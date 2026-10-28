// Token lint (D12): no arbitrary colours or font sizes outside the token block.
//  1. design.css: below the token blocks, colours and font sizes must come from variables.
//  2. Everything else: the count of raw hex colours and px font sizes may only go down
//     (a ratchet), so old pages can be moved over one by one while new code stays clean.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const BASELINE = join(root, "scripts/token-baseline.json");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const PX_FONT = /font-size:\s*\d+(\.\d+)?px|fontSize:\s*["']?\d+(px)?/g;

export function checkDesignCss() {
  const css = readFileSync(join(root, "src/app/design.css"), "utf8");
  const start = css.indexOf("/* ── Type ── */");
  const body = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
  const problems = [];
  body.split("\n").forEach((line, i) => {
    if (/rgba?\(|#[0-9a-fA-F]{3,8}\b/.test(line) && !/var\(--/.test(line) && !/rgba\((20, 20, 40|0, 0, 0)/.test(line)) problems.push(`design.css: raw colour: ${line.trim().slice(0, 90)}`);
    if (/font-size:\s*\d/.test(line)) problems.push(`design.css: raw font size: ${line.trim().slice(0, 90)}`);
  });
  return problems;
}

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx|css)$/.test(f) && !p.endsWith("design.css")) out.push(p);
  }
  return out;
}

export function countArbitrary() {
  let hex = 0, px = 0;
  for (const f of files(join(root, "src"))) {
    const t = readFileSync(f, "utf8");
    hex += (t.match(HEX) ?? []).length;
    px += (t.match(PX_FONT) ?? []).length;
  }
  return { hex, px };
}

if (process.argv[1] && process.argv[1].endsWith("check-tokens.mjs")) {
  const now = countArbitrary();
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
    console.log("Baseline updated", now);
  } else {
    const base = JSON.parse(readFileSync(BASELINE, "utf8"));
    const problems = checkDesignCss();
    if (now.hex > base.hex) problems.push(`Raw hex colours went up: ${now.hex} > ${base.hex}. Use a token.`);
    if (now.px > base.px) problems.push(`Raw px font sizes went up: ${now.px} > ${base.px}. Use --fs-*.`);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`Tokens OK (hex ${now.hex}/${base.hex}, px fonts ${now.px}/${base.px})`);
  }
}
