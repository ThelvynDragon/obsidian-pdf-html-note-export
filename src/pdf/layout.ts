/**
 * Collects layout information (text positions, links, headings) from the
 * rendered export document, in CSS pixels relative to the exported element.
 * Runs inside the isolated export iframe; no Obsidian API is used here.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextRun extends Box {
  /** Text in visual (left-to-right) order, ready to be written to the PDF. */
  text: string;
  fontSize: number;
}

export interface LinkArea {
  boxes: Box[];
  /** External URL (http, https, mailto...). */
  url?: string;
  /** Index into the headings list for links pointing inside the note. */
  heading?: number;
}

export interface HeadingMark {
  level: number;
  title: string;
  y: number;
}

export interface PageLayout {
  runs: TextRun[];
  links: LinkArea[];
  headings: HeadingMark[];
}

const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const EXTERNAL_URL = /^(https?:|mailto:|tel:|obsidian:)/i;
const SKIPPED_TAGS = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE"]);

export function collectLayout(root: HTMLElement, noteName: string): PageLayout {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const origin = root.getBoundingClientRect();
  const toBox = (r: DOMRect): Box => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });

  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  const graphemes = (s: string): string[] =>
    segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);

  // ── Text runs ───────────────────────────────────────────
  const runs: TextRun[] = [];
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const content = node.textContent ?? "";
    if (!parent || SKIPPED_TAGS.has(parent.tagName) || !content.trim()) continue;

    const style = win.getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const fontSize = parseFloat(style.fontSize) || 16;

    const words = /\S+/g;
    for (let m = words.exec(content); m; m = words.exec(content)) {
      const range = doc.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);

      if (rects.length === 1) {
        runs.push({ ...toBox(rects[0]), text: visualOrder(m[0], graphemes), fontSize });
        continue;
      }

      // Word broken across lines: place each grapheme individually
      let offset = m.index;
      for (const g of graphemes(m[0])) {
        const gr = doc.createRange();
        gr.setStart(node, offset);
        gr.setEnd(node, offset + g.length);
        offset += g.length;
        const r = Array.from(gr.getClientRects()).find((q) => q.width > 0 && q.height > 0);
        if (r) runs.push({ ...toBox(r), text: g, fontSize });
      }
    }
  }

  // ── Headings (for the PDF outline and in-note links) ────
  const headingEls = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
  const headings: HeadingMark[] = headingEls.map((el) => ({
    level: Number(el.tagName.substring(1)),
    title: (el.getAttribute("data-heading") ?? el.textContent ?? "").trim(),
    y: el.getBoundingClientRect().top - origin.top,
  }));
  const findHeading = (name: string): number => {
    const wanted = normalizeHeading(name);
    return headings.findIndex((h) => normalizeHeading(h.title) === wanted);
  };

  // ── Links ───────────────────────────────────────────────
  const links: LinkArea[] = [];
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a"))) {
    const boxes = Array.from(a.getClientRects()).filter((r) => r.width > 0 && r.height > 0).map(toBox);
    if (boxes.length === 0) continue;

    const target = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    if (EXTERNAL_URL.test(target)) {
      links.push({ boxes, url: target });
      continue;
    }

    // [[#Heading]] or [[This note#Heading]] -> jump inside the PDF
    const hash = target.indexOf("#");
    if (hash >= 0) {
      const note = safeDecode(target.substring(0, hash));
      if (note === "" || note === noteName) {
        const index = findHeading(safeDecode(target.substring(hash + 1)));
        if (index >= 0) links.push({ boxes, heading: index });
      }
    }
  }

  return { runs, links, headings };
}

/** PDF text is stored in visual order: reverse right-to-left words. */
function visualOrder(word: string, graphemes: (s: string) => string[]): string {
  return RTL_CHARS.test(word) ? graphemes(word).reverse().join("") : word;
}

function normalizeHeading(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
