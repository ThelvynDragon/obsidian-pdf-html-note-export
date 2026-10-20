import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFPage,
  PDFRef,
  PDFString,
  rgb,
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
} from "pdf-lib";
import type { Box, PageLayout } from "./layout";
import { GlyphLessTextFont, GLYPH_WIDTH } from "./text-font";

const MM = 72 / 25.4;
export const PAGE_FORMATS: Record<string, [number, number]> = {
  a4: [210 * MM, 297 * MM],
  a5: [148 * MM, 210 * MM],
  letter: [612, 792],
  legal: [612, 1008],
};
export const MARGIN = 15 * MM;

export interface BuildPdfOptions {
  /** PNG of the whole rendered note. */
  png: ArrayBuffer;
  /** Width of the rendered note in CSS pixels. */
  cssWidth: number;
  layout: PageLayout;
  pageSize: string;
  title: string;
  /** Add an invisible, selectable and searchable text layer. */
  selectableText: boolean;
}

export interface Placement {
  page: number;
  /** PDF user-space coordinates (origin bottom-left). */
  x: number;
  top: number;
  width: number;
  height: number;
}

export async function buildPdf(opts: BuildPdfOptions): Promise<Uint8Array> {
  const [pageWidth, pageHeight] = PAGE_FORMATS[opts.pageSize] ?? PAGE_FORMATS.a4;
  const contentWidth = pageWidth - 2 * MARGIN;
  const usableHeight = pageHeight - 2 * MARGIN;
  const scale = contentWidth / opts.cssWidth; // CSS px -> PDF pt

  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title, { showInWindowTitleBar: true });
  pdf.setCreator("PDF and HTML Note Export");
  pdf.setProducer("PDF and HTML Note Export (pdf-lib)");

  const image = await pdf.embedPng(opts.png);
  const imgHeight = (image.height * contentWidth) / image.width;
  const pageCount = Math.max(1, Math.ceil(imgHeight / usableHeight - 1e-6));
  const white = rgb(1, 1, 1);

  const pages: PDFPage[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    const imageTop = pageHeight - MARGIN + i * usableHeight;
    page.drawImage(image, { x: MARGIN, y: imageTop - imgHeight, width: contentWidth, height: imgHeight });
    page.drawRectangle({ x: 0, y: pageHeight - MARGIN, width: pageWidth, height: MARGIN, color: white });
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: MARGIN, color: white });
    pages.push(page);
  }

  /** Maps a CSS box to its page and PDF coordinates (by vertical centre). */
  const place = (b: Box): Placement => {
    const top = b.y * scale;
    const height = b.h * scale;
    const page = Math.min(pageCount - 1, Math.max(0, Math.floor((top + height / 2) / usableHeight)));
    return {
      page,
      x: MARGIN + b.x * scale,
      top: pageHeight - MARGIN - (top - page * usableHeight),
      width: b.w * scale,
      height,
    };
  };

  // ── Invisible text layer ───────────────────────────────
  if (opts.selectableText && opts.layout.runs.length > 0) {
    const font = new GlyphLessTextFont(pdf);
    const fontKeys = pages.map((p) => p.node.newFontDictionary("GlyphLess", font.ref));

    for (const run of opts.layout.runs) {
      const at = place(run);
      const size = run.fontSize * scale;
      const { hex, length } = font.encode(run.text);
      const natural = (length * GLYPH_WIDTH * size) / 1000;
      if (natural <= 0) continue;
      const baseline = at.top - at.height * 0.8;
      pages[at.page].pushOperators(
        pushGraphicsState(),
        beginText(),
        setFontAndSize(fontKeys[at.page], size),
        setTextRenderingMode(TextRenderingMode.Invisible),
        setCharacterSqueeze((at.width / natural) * 100),
        setTextMatrix(1, 0, 0, 1, at.x, baseline),
        showText(hex),
        endText(),
        popGraphicsState()
      );
    }
    font.finalize();
  }

  addLinksAndOutline(pdf, pages, opts.layout, place);

  return pdf.save();
}

/** Adds clickable links and the heading outline, shared by both PDF modes. */
export function addLinksAndOutline(
  pdf: PDFDocument,
  pages: PDFPage[],
  layout: Pick<PageLayout, "links" | "headings">,
  place: (b: Box) => Placement
): void {
  // ── Heading destinations (outline + in-note links) ─────
  const destinations = layout.headings.map((h) => {
    const at = place({ x: 0, y: h.y, w: 0, h: 0 });
    return pdf.context.obj([pages[at.page].ref, PDFName.of("XYZ"), PDFNull, PDFNumber.of(at.top + 4), PDFNull]);
  });

  // ── Clickable links ────────────────────────────────────
  for (const link of layout.links) {
    for (const box of link.boxes) {
      const at = place(box);
      const annot = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [at.x, at.top - at.height, at.x + at.width, at.top],
        Border: [0, 0, 0],
      });
      if (link.url) {
        annot.set(PDFName.of("A"), pdf.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(encodeURI(safeDecodeUri(link.url))) }));
      } else if (link.heading !== undefined && destinations[link.heading]) {
        annot.set(PDFName.of("Dest"), destinations[link.heading]);
      } else {
        continue;
      }
      pages[at.page].node.addAnnot(pdf.context.register(annot));
    }
  }

  // ── Outline (bookmarks panel) ──────────────────────────
  if (layout.headings.length > 0) {
    addOutline(pdf, layout.headings.map((h, i) => ({ level: h.level, title: h.title, dest: destinations[i] })));
  }
}

interface OutlineNode {
  title: string;
  dest: ReturnType<PDFDocument["context"]["obj"]>;
  ref: PDFRef;
  children: OutlineNode[];
  level: number;
}

function addOutline(pdf: PDFDocument, items: { level: number; title: string; dest: OutlineNode["dest"] }[]): void {
  const ctx = pdf.context;
  const rootRef = ctx.nextRef();
  const root: OutlineNode = { title: "", dest: ctx.obj([]), ref: rootRef, children: [], level: 0 };

  // Nest headings by level (an h3 directly under an h1 is attached to it)
  const stack: OutlineNode[] = [root];
  for (const item of items) {
    const node: OutlineNode = { ...item, title: item.title || "Untitled", ref: ctx.nextRef(), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const countAll = (n: OutlineNode): number => n.children.reduce((sum, c) => sum + 1 + countAll(c), 0);

  const write = (parent: OutlineNode): void => {
    parent.children.forEach((node, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(node.title),
        Parent: parent.ref,
        Dest: node.dest,
      });
      if (i > 0) dict.set(PDFName.of("Prev"), parent.children[i - 1].ref);
      if (i < parent.children.length - 1) dict.set(PDFName.of("Next"), parent.children[i + 1].ref);
      if (node.children.length > 0) {
        dict.set(PDFName.of("First"), node.children[0].ref);
        dict.set(PDFName.of("Last"), node.children[node.children.length - 1].ref);
        dict.set(PDFName.of("Count"), PDFNumber.of(countAll(node)));
      }
      ctx.assign(node.ref, dict);
      write(node);
    });
  };
  write(root);

  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: root.children[0].ref,
      Last: root.children[root.children.length - 1].ref,
      Count: countAll(root),
    })
  );
  pdf.catalog.set(PDFName.of("Outlines"), rootRef);
  pdf.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

function safeDecodeUri(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
