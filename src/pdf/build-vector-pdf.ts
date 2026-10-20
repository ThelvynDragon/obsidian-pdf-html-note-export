import {
  PDFDocument,
  PDFImage,
  PDFName,
  PDFOperator,
  PDFPage,
  pushGraphicsState,
  popGraphicsState,
  beginText,
  endText,
  setFontAndSize,
  setTextRenderingMode,
  TextRenderingMode,
  setCharacterSqueeze,
  setTextMatrix,
  showText,
  setFillingRgbColor,
  setStrokingRgbColor,
  setLineWidth,
  setLineCap,
  setLineJoin,
  LineCapStyle,
  LineJoinStyle,
  setGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  rectangle,
  clip,
  endPath,
  fill,
  stroke,
  concatTransformationMatrix,
  drawObject,
} from "pdf-lib";
import type { Box, PageLayout } from "./layout";
import type { FontKey, FontSet } from "./fonts";
import { EmbeddedFont } from "./ttf";
import { GlyphLessTextFont, GLYPH_WIDTH } from "./text-font";
import type { Rgba, VectorLayout } from "./vector-layout";
import { addLinksAndOutline, MARGIN, PAGE_FORMATS, type Placement } from "./build-pdf";

export interface BuildVectorPdfOptions {
  vector: VectorLayout;
  layout: Pick<PageLayout, "links" | "headings">;
  fonts: FontSet;
  cssWidth: number;
  pageSize: string;
  title: string;
}

const KAPPA = 0.5523;

export async function buildVectorPdf(opts: BuildVectorPdfOptions): Promise<Uint8Array> {
  const [pageWidth, pageHeight] = PAGE_FORMATS[opts.pageSize] ?? PAGE_FORMATS.a4;
  const contentWidth = pageWidth - 2 * MARGIN;
  const usableHeight = pageHeight - 2 * MARGIN;
  const s = contentWidth / opts.cssWidth; // CSS px -> PDF pt
  const pageCss = usableHeight / s;

  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title, { showInWindowTitleBar: true });
  pdf.setCreator("PDF and HTML Note Export");
  pdf.setProducer("PDF and HTML Note Export (pdf-lib)");

  const { items } = opts.vector;
  const breaks = paginate(opts.vector, pageCss);
  const pages: PDFPage[] = breaks.slice(0, -1).map(() => pdf.addPage([pageWidth, pageHeight]));

  const pageIndexAt = (y: number): number => {
    let i = 0;
    while (i < pages.length - 1 && y >= breaks[i + 1]) i++;
    return i;
  };
  const place = (b: Box): Placement => {
    const page = pageIndexAt(b.y + b.h / 2);
    return {
      page,
      x: MARGIN + b.x * s,
      top: pageHeight - MARGIN - (b.y - breaks[page]) * s,
      width: b.w * s,
      height: b.h * s,
    };
  };

  // Shared resources
  const embedded = new Map<FontKey, EmbeddedFont>();
  const fontNames = new Map<string, PDFName>();
  const images = new Map<string, PDFImage>();
  const alphaStates = new Map<string, PDFName>();
  const xObjects = new Map<string, PDFName>();
  let hiddenFont: GlyphLessTextFont | null = null;
  let tag = 0;

  const fontName = (page: PDFPage, pageIndex: number, key: FontKey): { name: PDFName; font: EmbeddedFont } => {
    let font = embedded.get(key);
    if (!font) {
      font = new EmbeddedFont(pdf, opts.fonts[key], subsetTag(tag++));
      embedded.set(key, font);
    }
    const id = `${pageIndex}|${key}`;
    let name = fontNames.get(id);
    if (!name) {
      name = page.node.newFontDictionary(key, font.ref);
      fontNames.set(id, name);
    }
    return { name, font };
  };

  const alpha = (page: PDFPage, pageIndex: number, a: number): PDFOperator[] => {
    if (a >= 0.999) return [];
    const id = `${pageIndex}|${a.toFixed(3)}`;
    let name = alphaStates.get(id);
    if (!name) {
      name = page.node.newExtGState("GS", pdf.context.obj({ Type: "ExtGState", ca: a, CA: a }));
      alphaStates.set(id, name);
    }
    return [setGraphicsState(name)];
  };

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const top = breaks[p];
    const bottom = breaks[p + 1];
    const X = (x: number): number => MARGIN + x * s;
    const Y = (y: number): number => pageHeight - MARGIN - (y - top) * s;
    const ops: PDFOperator[] = [pushGraphicsState(), rectangle(MARGIN, MARGIN, contentWidth, usableHeight), clip(), endPath()];

    const clipOps = (c: Box | undefined): PDFOperator[] =>
      c ? [rectangle(X(c.x), Y(c.y + c.h), c.w * s, c.h * s), clip(), endPath()] : [];
    const color = (c: Rgba): PDFOperator => setFillingRgbColor(c.r, c.g, c.b);

    for (const item of items) {
      const b = item.box;
      if (b.y >= bottom || b.y + b.h <= top) continue;
      if (item.clip && (item.clip.w <= 0 || item.clip.h <= 0)) continue;
      ops.push(pushGraphicsState(), ...clipOps(item.clip));

      switch (item.kind) {
        case "fill": {
          ops.push(...alpha(page, p, item.color.a), color(item.color));
          ops.push(...roundedRect(X(b.x), Y(b.y), b.w * s, b.h * s, item.radii.map((r) => r * s), false));
          if (item.hole && item.hole.w > 0 && item.hole.h > 0) {
            const inset = item.hole.x - b.x;
            const innerRadii = item.radii.map((r) => Math.max(0, r - inset) * s);
            ops.push(...roundedRect(X(item.hole.x), Y(item.hole.y), item.hole.w * s, item.hole.h * s, innerRadii, true));
          }
          ops.push(fill());
          break;
        }
        case "text": {
          const { name, font } = fontName(page, p, item.font);
          const size = item.size * s;
          const { hex, width } = font.encode(item.text);
          const natural = width * size;
          const squeeze = natural > 0 ? clampSqueeze((b.w * s * 100) / natural) : 100;
          const baseline = Y(b.y + item.baseline);
          ops.push(
            ...alpha(page, p, item.color.a),
            color(item.color),
            beginText(),
            setFontAndSize(name, size),
            setTextRenderingMode(TextRenderingMode.Fill),
            setCharacterSqueeze(squeeze),
            setTextMatrix(1, 0, 0, 1, X(b.x), baseline),
            showText(hex),
            endText()
          );
          for (const d of item.decorations) {
            const thickness = Math.max(0.5, size * 0.06);
            const y = d.type === "underline" ? baseline - size * 0.12 : baseline + size * 0.28;
            ops.push(color(d.color), rectangle(X(b.x), y - thickness / 2, b.w * s, thickness), fill());
          }
          break;
        }
        case "hidden-text": {
          hiddenFont ??= new GlyphLessTextFont(pdf);
          const name = fontNames.get(`${p}|hidden`) ?? page.node.newFontDictionary("GlyphLess", hiddenFont.ref);
          fontNames.set(`${p}|hidden`, name);
          const size = item.size * s;
          const { hex, length } = hiddenFont.encode(item.text);
          const natural = (length * GLYPH_WIDTH * size) / 1000;
          ops.push(
            beginText(),
            setFontAndSize(name, size),
            setTextRenderingMode(TextRenderingMode.Invisible),
            setCharacterSqueeze(natural > 0 ? (b.w * s * 100) / natural : 100),
            setTextMatrix(1, 0, 0, 1, X(b.x), Y(b.y + b.h * 0.8)),
            showText(hex),
            endText()
          );
          break;
        }
        case "image": {
          let img = images.get(item.image.key);
          if (!img) {
            try {
              img = item.image.format === "png" ? await pdf.embedPng(item.image.bytes) : await pdf.embedJpg(item.image.bytes);
            } catch (e) {
              console.warn("PDF and HTML Note Export: could not embed image", e);
              ops.push(popGraphicsState());
              continue;
            }
            images.set(item.image.key, img);
          }
          const xId = `${p}|${item.image.key}`;
          const xName = xObjects.get(xId) ?? page.node.newXObject("Im", img.ref);
          xObjects.set(xId, xName);
          if (item.radius > 0) {
            const r = item.radius * s;
            ops.push(...roundedRect(X(b.x), Y(b.y), b.w * s, b.h * s, [r, r, r, r], false), clip(), endPath());
          }
          ops.push(concatTransformationMatrix(b.w * s, 0, 0, b.h * s, X(b.x), Y(b.y + b.h)), drawObject(xName));
          break;
        }
        case "checkbox": {
          const w = b.w * s;
          const h = b.h * s;
          const r = Math.min(w, h) * 0.18;
          const x = X(b.x);
          const y = Y(b.y);
          if (item.checked) {
            ops.push(color(item.color), ...roundedRect(x, y, w, h, [r, r, r, r], false), fill());
            ops.push(
              setStrokingRgbColor(1, 1, 1),
              setLineWidth(Math.max(0.8, w * 0.13)),
              setLineCap(LineCapStyle.Round),
              setLineJoin(LineJoinStyle.Round),
              moveTo(x + w * 0.24, y - h * 0.52),
              lineTo(x + w * 0.43, y - h * 0.72),
              lineTo(x + w * 0.77, y - h * 0.3),
              stroke()
            );
          } else {
            const bw = Math.max(0.6, w * 0.08);
            ops.push(setFillingRgbColor(0.6, 0.62, 0.67), ...roundedRect(x, y, w, h, [r, r, r, r], false));
            ops.push(...roundedRect(x + bw, y - bw, w - 2 * bw, h - 2 * bw, [r, r, r, r].map((v) => Math.max(0, v - bw)), true), fill());
          }
          break;
        }
      }
      ops.push(popGraphicsState());
    }

    ops.push(popGraphicsState());
    page.pushOperators(...ops);
  }

  for (const font of embedded.values()) font.finalize();
  hiddenFont?.finalize();

  addLinksAndOutline(pdf, pages, opts.layout, place);
  return pdf.save();
}

/** Chooses page breaks that never split a line, image, table row or heading + next line. */
export function paginate(layout: VectorLayout, pageCss: number): number[] {
  const blocks = layout.blocks.slice().sort((a, b) => a.top - b.top);

  // Keep headings with the following block
  const ranges: { top: number; bottom: number }[] = blocks.map((b) => ({ top: b.top, bottom: b.bottom }));
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].keepWithNext) continue;
    const next = blocks.find((b) => b.top >= blocks[i].bottom - 1);
    if (next && next.bottom - blocks[i].top < pageCss * 0.5) ranges[i].bottom = Math.max(ranges[i].bottom, next.bottom);
  }

  // Merge overlapping ranges
  ranges.sort((a, b) => a.top - b.top);
  const merged: { top: number; bottom: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.top < last.bottom - 0.5) last.bottom = Math.max(last.bottom, r.bottom);
    else merged.push({ ...r });
  }

  const contentBottom = Math.max(0, ...layout.items.map((i) => i.box.y + i.box.h));
  const end = Math.min(layout.height, contentBottom + 40);
  const breaks = [0];
  let start = 0;
  while (start + pageCss < end - 1) {
    const limit = start + pageCss;
    const hit = merged.find((r) => r.top < limit && r.bottom > limit);
    const cut = hit && hit.top > start + pageCss * 0.2 ? hit.top - 0.5 : limit;
    breaks.push(cut);
    start = cut;
  }
  breaks.push(Math.max(end, start + 1));
  return breaks;
}

function clampSqueeze(v: number): number {
  return v > 25 && v < 400 ? v : 100;
}

function subsetTag(n: number): string {
  let tag = "";
  let v = n;
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (v % 26));
    v = Math.floor(v / 26);
  }
  return tag;
}

/** Rounded rectangle path; (x, y) is the top-left corner in PDF space. */
function roundedRect(x: number, y: number, w: number, h: number, radii: number[], reverse: boolean): PDFOperator[] {
  const [tl, tr, br, bl] = radii;
  const right = x + w;
  const bottom = y - h;
  type Seg = { to: [number, number]; c?: [number, number, number, number] };
  // Clockwise (visually) starting after the top-left corner
  const pts: Seg[] = [
    { to: [right - tr, y] },
    { to: [right, y - tr], c: [right - tr + tr * KAPPA, y, right, y - tr + tr * KAPPA] },
    { to: [right, bottom + br] },
    { to: [right - br, bottom], c: [right, bottom + br - br * KAPPA, right - br + br * KAPPA, bottom] },
    { to: [x + bl, bottom] },
    { to: [x, bottom + bl], c: [x + bl - bl * KAPPA, bottom, x, bottom + bl - bl * KAPPA] },
    { to: [x, y - tl] },
    { to: [x + tl, y], c: [x, y - tl + tl * KAPPA, x + tl - tl * KAPPA, y] },
  ];
  const ops: PDFOperator[] = [];
  if (!reverse) {
    ops.push(moveTo(x + tl, y));
    for (const p of pts) ops.push(p.c ? appendBezierCurve(p.c[0], p.c[1], p.c[2], p.c[3], p.to[0], p.to[1]) : lineTo(p.to[0], p.to[1]));
  } else {
    // Walk the same outline backwards (for holes with the nonzero rule)
    const start: [number, number] = [x + tl, y];
    const points: [number, number][] = [start, ...pts.map((p) => p.to)];
    ops.push(moveTo(start[0], start[1]));
    for (let i = pts.length - 1; i >= 0; i--) {
      const seg = pts[i];
      const from = points[i];
      if (seg.c) ops.push(appendBezierCurve(seg.c[2], seg.c[3], seg.c[0], seg.c[1], from[0], from[1]));
      else ops.push(lineTo(from[0], from[1]));
    }
  }
  ops.push(closePath());
  return ops;
}

