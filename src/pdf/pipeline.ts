import html2canvas from "html2canvas";
import { collectLayout } from "./layout";
import { buildPdf } from "./build-pdf";
import { buildVectorPdf } from "./build-vector-pdf";
import { loadFonts, registerFonts } from "./fonts";
import { collectVectorLayout, injectListMarkers } from "./vector-layout";

/**
 * PDF generation from a rendered export frame. Independent from the
 * Obsidian API so it can be tested in a plain browser.
 */

export interface PipelineOptions {
  cssWidth: number;
  pageSize: string;
  title: string;
  noteName: string;
  selectableText: boolean;
}

export interface PipelineResult {
  bytes: Uint8Array;
  stats: Record<string, number>;
}

/** 1.x behaviour: one picture of the page plus an optional invisible text layer. */
export async function renderImagePdf(target: HTMLElement, opts: PipelineOptions): Promise<PipelineResult> {
  const t0 = performance.now();
  const layout = collectLayout(target, opts.noteName);
  const canvas = await html2canvas(target, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    width: opts.cssWidth,
    windowWidth: opts.cssWidth,
  });
  const png = await canvasToPng(canvas);
  const bytes = await buildPdf({
    png,
    cssWidth: opts.cssWidth,
    layout,
    pageSize: opts.pageSize,
    title: opts.title,
    selectableText: opts.selectableText,
  });
  return { bytes, stats: { ms: Math.round(performance.now() - t0) } };
}

/**
 * Hybrid vector mode: real text with embedded fonts, vector boxes and borders,
 * native images; everything else as small images.
 * The frame must contain VECTOR_FRAME_CSS.
 */
export async function renderVectorPdf(target: HTMLElement, opts: PipelineOptions): Promise<PipelineResult> {
  const t0 = performance.now();
  const doc = target.ownerDocument;
  const fonts = await loadFonts();
  await registerFonts(doc, fonts);
  injectListMarkers(target);
  await doc.fonts.ready;
  await nextFrame(doc);

  const t1 = performance.now();
  const layout = collectLayout(target, opts.noteName);
  const vector = await collectVectorLayout(target, fonts);
  const t2 = performance.now();
  const bytes = await buildVectorPdf({
    vector,
    layout,
    fonts,
    cssWidth: opts.cssWidth,
    pageSize: opts.pageSize,
    title: opts.title,
  });
  const t3 = performance.now();
  return {
    bytes,
    stats: {
      items: vector.items.length,
      rasterRuns: vector.rasterRuns,
      fontsMs: Math.round(t1 - t0),
      layoutMs: Math.round(t2 - t1),
      pdfMs: Math.round(t3 - t2),
    },
  };
}

/** Lets the frame re-layout with the new fonts (rAF is throttled in hidden frames). */
function nextFrame(doc: Document): Promise<void> {
  const win = doc.defaultView ?? window;
  return new Promise((resolve) => win.setTimeout(resolve, 50));
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the page image"));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, "image/png");
  });
}
