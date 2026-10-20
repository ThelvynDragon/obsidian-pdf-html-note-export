import html2canvas from "html2canvas";
import type { Box } from "./layout";
import { fontKeyFor, type FontKey, type FontSet } from "./fonts";

/**
 * Converts the rendered export frame into a flat display list (CSS pixels,
 * y pointing down, relative to the exported element). Text in the bundled
 * fonts becomes real PDF text; anything else (emoji, CJK, Arabic, SVG,
 * math, diagrams...) becomes a small image, with an invisible text layer
 * for text so it stays selectable and searchable.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RasterImage {
  key: string;
  bytes: Uint8Array;
  format: "png" | "jpg";
}

export type Item =
  | { kind: "fill"; box: Box; radii: [number, number, number, number]; color: Rgba; hole?: Box; clip?: Box }
  | {
      kind: "text";
      box: Box;
      text: string;
      font: FontKey;
      size: number;
      color: Rgba;
      baseline: number;
      decorations: { type: "underline" | "line-through"; color: Rgba }[];
      clip?: Box;
    }
  | { kind: "image"; box: Box; image: RasterImage; radius: number; clip?: Box }
  | { kind: "hidden-text"; box: Box; text: string; size: number; clip?: Box }
  | { kind: "checkbox"; box: Box; checked: boolean; color: Rgba; clip?: Box };

export interface VectorLayout {
  items: Item[];
  /** Vertical ranges that must not be split by a page break. */
  blocks: { top: number; bottom: number; keepWithNext: boolean }[];
  height: number;
  /** Number of text runs drawn as images (for diagnostics). */
  rasterRuns: number;
}

const ISLANDS = "svg, canvas, video, iframe, object, embed, mjx-container, .math, .mermaid";
const SKIPPED_TAGS = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE", "HEAD", "BR", "WBR"]);
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const TEXT_SCALE = 4;
const ISLAND_SCALE = 3;

export async function collectVectorLayout(root: HTMLElement, fonts: FontSet): Promise<VectorLayout> {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const origin = root.getBoundingClientRect();
  const items: Item[] = [];
  const blocks: VectorLayout["blocks"] = [];
  const rasterCache = new Map<string, RasterImage>();
  let rasterRuns = 0;

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const graphemes = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s));

  const toBox = (r: DOMRect): Box => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  const block = (b: Box, keepWithNext = false): void => {
    if (b.h > 0) blocks.push({ top: b.y, bottom: b.y + b.h, keepWithNext });
  };

  // ── Elements ───────────────────────────────────────────
  const paintElement = async (el: Element, clip: Box | undefined): Promise<void> => {
    if (SKIPPED_TAGS.has(el.tagName)) return;
    const style = win.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return;

    if (el !== root && el.matches(ISLANDS)) {
      const box = toBox(el.getBoundingClientRect());
      if (box.w > 0 && box.h > 0) {
        const image = await rasterizeElement(el, box);
        if (image) items.push({ kind: "image", box, image, radius: 0, clip });
        block(box);
      }
      return;
    }

    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      const box = toBox(img.getBoundingClientRect());
      const image = await imageFromImg(img);
      if (image && box.w > 0 && box.h > 0) {
        items.push({ kind: "image", box, image, radius: parseFloat(style.borderTopLeftRadius) || 0, clip });
        block(box);
      }
      return;
    }

    if (el.tagName === "INPUT") {
      const input = el as HTMLInputElement;
      if (input.type === "checkbox") {
        const box = toBox(input.getBoundingClientRect());
        const accent = parseColor(win.getComputedStyle(root).getPropertyValue("--ne-color-accent")) ?? { r: 0.15, g: 0.39, b: 0.92, a: 1 };
        items.push({ kind: "checkbox", box, checked: input.checked || input.hasAttribute("checked"), color: accent, clip });
        block(box);
      }
      return;
    }

    paintBoxes(el, style, clip);

    if (el.tagName === "TR" || el.tagName === "HR") block(toBox(el.getBoundingClientRect()));
    if (/^H[1-6]$/.test(el.tagName)) block(toBox(el.getBoundingClientRect()), true);

    let childClip = clip;
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const r = el.getBoundingClientRect();
      const inner: Box = {
        x: r.left - origin.left + (parseFloat(style.borderLeftWidth) || 0),
        y: r.top - origin.top + (parseFloat(style.borderTopWidth) || 0),
        w: el.clientWidth,
        h: el.clientHeight,
      };
      childClip = clip ? intersect(clip, inner) : inner;
    }

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) await paintText(child as Text, style, childClip);
      else if (child.nodeType === 1) await paintElement(child as Element, childClip);
    }
  };

  // ── Backgrounds and borders ────────────────────────────
  const paintBoxes = (el: Element, style: CSSStyleDeclaration, clip: Box | undefined): void => {
    const bg = parseColor(style.backgroundColor);
    const sides = (["Top", "Right", "Bottom", "Left"] as const).map((side) => {
      const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
      const bstyle = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const color = parseColor(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
      return width > 0 && bstyle !== "none" && bstyle !== "hidden" && color ? { width, color } : null;
    });
    if (!bg && sides.every((s) => !s)) return;

    const inline = style.display === "inline";
    const collapsed = style.display === "table-cell" && style.borderCollapse === "collapse";
    const rects = (inline ? Array.from(el.getClientRects()) : [el.getBoundingClientRect()]).filter((r) => r.width > 0 && r.height > 0);
    rects.forEach((r, i) => {
      const box = toBox(r);
      const radii: [number, number, number, number] = [
        parseFloat(style.borderTopLeftRadius) || 0,
        parseFloat(style.borderTopRightRadius) || 0,
        parseFloat(style.borderBottomRightRadius) || 0,
        parseFloat(style.borderBottomLeftRadius) || 0,
      ].map((v) => Math.min(v, box.w / 2, box.h / 2)) as [number, number, number, number];

      if (bg) items.push({ kind: "fill", box, radii, color: bg, clip });

      const [top, right, bottom, left] = sides;
      const showLeft = !inline || i === 0;
      const showRight = !inline || i === rects.length - 1;
      const uniform =
        top && right && bottom && left && showLeft && showRight &&
        [right, bottom, left].every((s) => s.width === top.width && sameColor(s.color, top.color));

      if (uniform && radii.some((v) => v > 0)) {
        const w = top.width;
        items.push({ kind: "fill", box, radii, color: top.color, hole: { x: box.x + w, y: box.y + w, w: box.w - 2 * w, h: box.h - 2 * w }, clip });
        return;
      }
      const zero: [number, number, number, number] = [0, 0, 0, 0];
      if (collapsed) {
        // Collapsed table borders are shared: draw them centred on the cell edges
        const c = (side: { width: number } | null): number => (side ? side.width / 2 : 0);
        if (top) items.push({ kind: "fill", box: { x: box.x - c(left), y: box.y - c(top), w: box.w + c(left) + c(right), h: top.width }, radii: zero, color: top.color, clip });
        if (bottom) items.push({ kind: "fill", box: { x: box.x - c(left), y: box.y + box.h - c(bottom), w: box.w + c(left) + c(right), h: bottom.width }, radii: zero, color: bottom.color, clip });
        if (left) items.push({ kind: "fill", box: { x: box.x - c(left), y: box.y - c(top), w: left.width, h: box.h + c(top) + c(bottom) }, radii: zero, color: left.color, clip });
        if (right) items.push({ kind: "fill", box: { x: box.x + box.w - c(right), y: box.y - c(top), w: right.width, h: box.h + c(top) + c(bottom) }, radii: zero, color: right.color, clip });
        return;
      }
      if (top) items.push({ kind: "fill", box: { x: box.x, y: box.y, w: box.w, h: top.width }, radii: zero, color: top.color, clip });
      if (bottom) items.push({ kind: "fill", box: { x: box.x, y: box.y + box.h - bottom.width, w: box.w, h: bottom.width }, radii: zero, color: bottom.color, clip });
      if (left && showLeft) items.push({ kind: "fill", box: { x: box.x, y: box.y, w: left.width, h: box.h }, radii: zero, color: left.color, clip });
      if (right && showRight) items.push({ kind: "fill", box: { x: box.x + box.w - right.width, y: box.y, w: right.width, h: box.h }, radii: zero, color: right.color, clip });
    });
  };

  // ── Text ───────────────────────────────────────────────
  const paintText = async (node: Text, style: CSSStyleDeclaration, clip: Box | undefined): Promise<void> => {
    const content = node.textContent ?? "";
    if (!content.trim()) return;
    const color = parseColor(style.color);
    if (!color) return;

    const fontKey = fontKeyFor(style);
    const font = fontKey ? fonts[fontKey] : null;
    const size = parseFloat(style.fontSize) || 16;
    const decorations = collectDecorations(node.parentElement, win);
    const transform = style.textTransform;

    const words = /\S+/g;
    for (let m = words.exec(content); m; m = words.exec(content)) {
      // Split the word into segments drawable with our fonts or not
      const segments: { start: number; end: number; vector: boolean }[] = [];
      let offset = m.index;
      for (const g of graphemes(m[0])) {
        const vector = !!font && isDrawable(g, font);
        const last = segments[segments.length - 1];
        if (last && last.vector === vector) last.end = offset + g.length;
        else segments.push({ start: offset, end: offset + g.length, vector });
        offset += g.length;
      }

      for (const seg of segments) {
        const pieces = rangePieces(node, seg.start, seg.end);
        for (const piece of pieces) {
          const text = applyTransform(content.substring(piece.start, piece.end), transform);
          const box = toBox(piece.rect);
          block(box);
          if (seg.vector && font && fontKey) {
            const baseline = (box.h * font.ascent) / (font.ascent - font.descent);
            items.push({ kind: "text", box, text: text.normalize("NFC"), font: fontKey, size, color, baseline, decorations, clip });
          } else {
            const metrics = fonts["sans-regular"];
            const baseline = (box.h * metrics.ascent) / (metrics.ascent - metrics.descent);
            const image = await rasterizeText(text, style, box, baseline);
            if (image) items.push({ kind: "image", box: image.box, image: image.image, radius: 0, clip });
            rasterRuns++;
            const visual = RTL_CHARS.test(text) ? graphemes(text).reverse().join("") : text;
            items.push({ kind: "hidden-text", box, text: visual, size, clip });
          }
        }
      }
    }
  };

  /** Range rectangles of a text slice; per grapheme if it wraps across lines. */
  const rangePieces = (node: Text, start: number, end: number): { start: number; end: number; rect: DOMRect }[] => {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 1) return [{ start, end, rect: rects[0] }];
    const out: { start: number; end: number; rect: DOMRect }[] = [];
    let pos = start;
    for (const g of graphemes((node.textContent ?? "").substring(start, end))) {
      const r = doc.createRange();
      r.setStart(node, pos);
      r.setEnd(node, pos + g.length);
      const rect = Array.from(r.getClientRects()).find((q) => q.width > 0 && q.height > 0);
      if (rect) out.push({ start: pos, end: pos + g.length, rect });
      pos += g.length;
    }
    return out;
  };

  // ── Rasterisation helpers ─────────────────────────────
  const rasterizeText = async (
    text: string,
    style: CSSStyleDeclaration,
    box: Box,
    baseline: number
  ): Promise<{ image: RasterImage; box: Box } | null> => {
    const pad = box.h * 0.35;
    const key = `t|${text}|${style.fontStyle}|${style.fontWeight}|${style.fontSize}|${style.fontFamily}|${style.color}|${Math.round(box.w)}`;
    const outBox: Box = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
    const cached = rasterCache.get(key);
    if (cached) return { image: cached, box: outBox };

    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(outBox.w * TEXT_SCALE));
    canvas.height = Math.max(1, Math.ceil(outBox.h * TEXT_SCALE));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(TEXT_SCALE, TEXT_SCALE);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = style.color;
    ctx.textBaseline = "alphabetic";
    const rtl = style.direction === "rtl" || RTL_CHARS.test(text);
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    ctx.fillText(text, rtl ? pad + box.w : pad, pad + baseline);
    const image = await canvasImage(canvas, key);
    if (image) rasterCache.set(key, image);
    return image ? { image, box: outBox } : null;
  };

  const rasterizeElement = async (el: Element, box: Box): Promise<RasterImage | null> => {
    const key = `e|${items.length}`;
    if (el.tagName.toLowerCase() === "svg") {
      const image = await rasterizeSvg(el as SVGSVGElement, box, win, doc, key);
      if (image) return image;
    }
    try {
      const canvas = await html2canvas(el as HTMLElement, { scale: ISLAND_SCALE, backgroundColor: null, logging: false, useCORS: true });
      return await canvasImage(canvas, key);
    } catch (e) {
      console.warn("PDF and HTML Note Export: could not render element", e);
      return null;
    }
  };

  const imageFromImg = async (img: HTMLImageElement): Promise<RasterImage | null> => {
    const src = img.currentSrc || img.src;
    const key = `i|${src.length}|${src.substring(0, 64)}|${src.substring(src.length - 64)}`;
    const cached = rasterCache.get(key);
    if (cached) return cached;
    const direct = /^data:image\/(png|jpe?g);base64,/i.exec(src);
    let image: RasterImage | null = null;
    if (direct) {
      const bytes = base64Bytes(src.substring(direct[0].length));
      const format = direct[1].toLowerCase() === "png" ? "png" : "jpg";
      // pdf-lib only supports non-interlaced PNG; let the canvas re-encode if unsure
      if (format === "jpg" || !isInterlacedPng(bytes)) image = { key, bytes, format };
    }
    if (!image) {
      if (!img.complete || img.naturalWidth === 0) return null;
      const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = createEl("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        image = await canvasImage(canvas, key);
      } catch {
        return null; // tainted canvas (remote image without CORS)
      }
    }
    if (image) rasterCache.set(key, image);
    return image;
  };

  await paintElement(root, undefined);
  return { items, blocks, height: root.getBoundingClientRect().height, rasterRuns };
}

// ── Helpers ────────────────────────────────────────────────

function isDrawable(grapheme: string, font: { has(cp: number): boolean }): boolean {
  const text = grapheme.normalize("NFC");
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0x200d || !font.has(cp)) return false;
    count++;
  }
  // Combining sequences would need mark positioning: draw them as images
  return count === 1 || /^[\p{L}\p{N}\p{P}\p{S}]+$/u.test(text);
}

function applyTransform(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  return text;
}

function collectDecorations(el: Element | null, win: Window): { type: "underline" | "line-through"; color: Rgba }[] {
  const out: { type: "underline" | "line-through"; color: Rgba }[] = [];
  for (let e = el; e; e = e.parentElement) {
    const s = win.getComputedStyle(e);
    const line = s.textDecorationLine || "";
    const color = parseColor(s.textDecorationColor) ?? parseColor(s.color);
    if (color) {
      if (line.includes("underline") && !out.some((d) => d.type === "underline")) out.push({ type: "underline", color });
      if (line.includes("line-through") && !out.some((d) => d.type === "line-through")) out.push({ type: "line-through", color });
    }
    if (!s.display.startsWith("inline")) break;
  }
  return out;
}

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/** Parses rgb()/rgba()/#hex colors; returns null for fully transparent. */
export function parseColor(value: string): Rgba | null {
  const v = value.trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4]?.endsWith("%")) a /= 100;
    if (a <= 0) return null;
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a };
  }
  m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    const n = (i: number): number => parseInt(h.substring(i, i + 2), 16) / 255;
    const a = h.length === 8 ? n(6) : 1;
    return a <= 0 ? null : { r: n(0), g: n(2), b: n(4), a };
  }
  return null;
}

async function canvasImage(canvas: HTMLCanvasElement, key: string): Promise<RasterImage | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { key, bytes: new Uint8Array(await blob.arrayBuffer()), format: "png" };
}

async function rasterizeSvg(svg: SVGSVGElement, box: Box, win: Window, doc: Document, key: string): Promise<RasterImage | null> {
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(box.w));
    clone.setAttribute("height", String(box.h));
    const style = win.getComputedStyle(svg);
    clone.setAttribute("color", style.color);
    if (!clone.getAttribute("fill") && style.fill) clone.setAttribute("fill", style.fill);
    if (!clone.getAttribute("stroke") && style.stroke && style.stroke !== "none") clone.setAttribute("stroke", style.stroke);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new (win as unknown as { Image: typeof Image }).Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    await img.decode();
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(box.w * ISLAND_SCALE));
    canvas.height = Math.max(1, Math.ceil(box.h * ISLAND_SCALE));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasImage(canvas, key);
  } catch {
    return null;
  }
}

function base64Bytes(b64: string): Uint8Array {
  const bin = window.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isInterlacedPng(bytes: Uint8Array): boolean {
  // IHDR interlace method is at byte 28
  return bytes.length > 28 && bytes[28] === 1;
}

/** Adds list markers as real text so they can be drawn as vector glyphs. */
export function injectListMarkers(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const depthOf = (li: Element): number => {
    let depth = 0;
    for (let e = li.parentElement; e && e !== root; e = e.parentElement) if (e.tagName === "UL" || e.tagName === "OL") depth++;
    return depth;
  };

  for (const li of Array.from(root.querySelectorAll("li"))) {
    const style = win.getComputedStyle(li);
    if (style.display !== "list-item" || style.listStyleType === "none") continue;
    const list = li.parentElement;
    if (!list) continue;

    let marker: string;
    const type = style.listStyleType;
    if (list.tagName === "OL") {
      const items = Array.from(list.children).filter((c) => c.tagName === "LI");
      let n = parseInt(list.getAttribute("start") ?? "1", 10) || 1;
      for (const item of items) {
        const value = item.getAttribute("value");
        if (value !== null) n = parseInt(value, 10) || n;
        if (item === li) break;
        n++;
      }
      marker = `${formatCounter(n, type)}.`;
    } else {
      const bullets: Record<string, string> = { disc: "•", circle: "◦", square: "▪" };
      marker = bullets[type] ?? ["•", "◦", "▪"][(depthOf(li) - 1) % 3] ?? "•";
    }

    const span = createSpan({ cls: "ne-marker", text: marker });
    li.classList.add("ne-vector-li");
    li.insertBefore(span, li.firstChild);
  }
}

function formatCounter(n: number, type: string): string {
  const alpha = (upper: boolean): string => {
    let s = "";
    let v = n;
    while (v > 0) {
      v--;
      s = String.fromCharCode((upper ? 65 : 97) + (v % 26)) + s;
      v = Math.floor(v / 26);
    }
    return s;
  };
  const roman = (upper: boolean): string => {
    const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let s = "";
    let v = n;
    for (const [value, sym] of table) while (v >= value) { s += sym; v -= value; }
    return upper ? s.toUpperCase() : s;
  };
  switch (type) {
    case "lower-alpha":
    case "lower-latin":
      return alpha(false);
    case "upper-alpha":
    case "upper-latin":
      return alpha(true);
    case "lower-roman":
      return roman(false);
    case "upper-roman":
      return roman(true);
    default:
      return String(n);
  }
}
