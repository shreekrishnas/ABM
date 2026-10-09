// Splits a document into chunks for embedding. Markdown-aware: headings start new
// sections, sections are split on paragraphs into chunks of about TARGET words, and
// the last paragraph of a chunk is repeated at the start of the next (overlap) so an
// idea that spans a boundary is still found. Each chunk carries its document title
// and heading, because a chunk read on its own ("Keep it under 100 words") means
// little without knowing which play or persona it belongs to.

export interface Chunk {
  ord: number;
  heading: string | null;
  /** Text that is embedded and shown: "<title> › <heading>\n<body>". */
  text: string;
}

const TARGET = 220;
const MAX = 320;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Break one over-long paragraph on sentence ends. */
function splitLong(p: string): string[] {
  if (words(p) <= MAX) return [p];
  const sentences = p.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && words(cur) + words(s) > TARGET) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  // A single sentence longer than MAX words is cut on words.
  return out.flatMap((x) => {
    if (words(x) <= MAX) return [x];
    const w = x.split(/\s+/);
    const parts: string[] = [];
    for (let i = 0; i < w.length; i += TARGET) parts.push(w.slice(i, i + TARGET).join(" "));
    return parts;
  });
}

export function chunkDocument(title: string, text: string): Chunk[] {
  const sections: { heading: string | null; paras: string[] }[] = [{ heading: null, paras: [] }];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    const h = b.match(/^#{1,6}\s+(.+?)\s*#*$/m);
    if (h && b.startsWith("#")) {
      const rest = b.split("\n").slice(1).join("\n").trim();
      sections.push({ heading: h[1].trim(), paras: rest ? [rest] : [] });
    } else sections[sections.length - 1].paras.push(b);
  }

  const chunks: Chunk[] = [];
  for (const sec of sections) {
    const paras = sec.paras.flatMap(splitLong);
    if (!paras.length) continue;
    let cur: string[] = [];
    const flush = () => {
      if (!cur.length) return;
      const head = sec.heading ? `${title} › ${sec.heading}` : title;
      chunks.push({ ord: chunks.length, heading: sec.heading, text: `${head}\n${cur.join("\n\n")}` });
    };
    for (const p of paras) {
      if (cur.length && words(cur.join(" ")) + words(p) > TARGET) {
        flush();
        const last = cur[cur.length - 1];
        cur = words(last) <= 60 ? [last] : []; // overlap: carry a short last paragraph forward
      }
      cur.push(p);
    }
    flush();
  }
  return chunks;
}
