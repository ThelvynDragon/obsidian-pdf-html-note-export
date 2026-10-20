import { App, TFile, TFolder, Notice, normalizePath } from "obsidian";
import { renderNote, buildHtmlDocument } from "./renderer";
import { buildColorCss } from "./colors";
import { VECTOR_FRAME_CSS } from "./pdf/fonts";
import { renderImagePdf, renderVectorPdf, type PipelineOptions, type PipelineResult } from "./pdf/pipeline";
import type { NoteExportSettings } from "./settings";

const RENDER_WIDTH_PX = 800;

// ─────────────────────────────────────────
//  Vault helpers
// ─────────────────────────────────────────

async function ensureFolder(app: App, folderPath: string): Promise<string> {
  const normalized = normalizePath(folderPath || "exports");
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(`"${current}" exists and is not a folder`);
    await app.vault.createFolder(current);
  }
  return normalized;
}

function uniquePath(app: App, folder: string, basename: string, extension: string): string {
  let candidate = normalizePath(`${folder}/${basename}.${extension}`);
  let counter = 1;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(`${folder}/${basename} (${counter}).${extension}`);
    counter++;
  }
  return candidate;
}

/**
 * Writes through the Vault API (preferred), falling back to the adapter
 * if the vault index is out of sync with the file system.
 */
async function writeFile(app: App, path: string, data: string | ArrayBuffer): Promise<void> {
  try {
    if (typeof data === "string") await app.vault.create(path, data);
    else await app.vault.createBinary(path, data);
  } catch (e) {
    console.warn("PDF and HTML Note Export: Vault API write failed, using adapter", e);
    if (typeof data === "string") await app.vault.adapter.write(path, data);
    else await app.vault.adapter.writeBinary(path, data);
  }
}

// ─────────────────────────────────────────
//  HTML5 export
// ─────────────────────────────────────────

export async function exportAsHtml(app: App, file: TFile, settings: NoteExportSettings): Promise<void> {
  const notice = new Notice("Generating HTML…", 0);
  try {
    const rendered = await renderNote(app, file, settings);
    const html = buildHtmlDocument(rendered, file.basename, settings, buildColorCss(settings));

    const folder = await ensureFolder(app, settings.exportFolder);
    const path = uniquePath(app, folder, file.basename, "html");
    await writeFile(app, path, html);

    notice.hide();
    new Notice(`HTML exported to ${path}`);
  } catch (e) {
    notice.hide();
    console.error("PDF and HTML Note Export: HTML export failed", e);
    new Notice(`HTML export failed: ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────
//  PDF export (vector or image, pdf-lib)
// ─────────────────────────────────────────

export async function exportAsPdf(app: App, file: TFile, settings: NoteExportSettings): Promise<void> {
  const notice = new Notice("Generating PDF…", 0);
  try {
    const rendered = await renderNote(app, file, settings);
    const colorCss = buildColorCss(settings);
    const opts: PipelineOptions = {
      cssWidth: RENDER_WIDTH_PX,
      pageSize: settings.pageSize,
      title: file.basename,
      noteName: file.basename,
      selectableText: settings.selectableText,
    };

    let result: PipelineResult | null = null;
    if (settings.pdfMode === "vector") {
      try {
        const html = buildHtmlDocument(rendered.cloneNode(true) as HTMLElement, file.basename, settings, colorCss + VECTOR_FRAME_CSS);
        result = await withFrame(html, (target) => renderVectorPdf(target, opts));
      } catch (e) {
        console.warn("PDF and HTML Note Export: vector rendering failed, falling back to image mode", e);
        new Notice("Vector rendering failed, using image mode instead.");
      }
    }
    if (!result) {
      const html = buildHtmlDocument(rendered, file.basename, settings, colorCss);
      result = await withFrame(html, (target) => renderImagePdf(target, opts));
    }

    const bytes = result.bytes;
    const folder = await ensureFolder(app, settings.exportFolder);
    const path = uniquePath(app, folder, file.basename, "pdf");
    await writeFile(app, path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    notice.hide();
    new Notice(`PDF exported to ${path}`);
  } catch (e) {
    notice.hide();
    console.error("PDF and HTML Note Export: PDF export failed", e);
    new Notice(`PDF export failed: ${(e as Error).message}`);
  }
}

/**
 * Renders the export document in an isolated, off-screen iframe so the
 * export theme never leaks into Obsidian's own interface.
 */
async function withFrame<T>(html: string, run: (target: HTMLElement) => Promise<T>): Promise<T> {
  const iframe = document.body.createEl("iframe", { cls: "pdf-html-note-export-frame" });
  try {
    const loaded = new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
    });
    iframe.srcdoc = html;
    await loaded;

    const frameDoc = iframe.contentDocument;
    const target = frameDoc?.querySelector<HTMLElement>(".ne-container");
    if (!frameDoc || !target) throw new Error("Could not prepare the rendering frame");

    // Let fonts and inline images settle
    await frameDoc.fonts?.ready;
    await sleep(200);
    return await run(target);
  } finally {
    iframe.remove();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
