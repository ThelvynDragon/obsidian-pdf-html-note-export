import { App, TFile, TFolder, Notice, normalizePath } from "obsidian";
import { PDFDocument, rgb } from "pdf-lib";
import html2canvas from "html2canvas";
import { renderNote, buildHtmlDocument } from "./renderer";
import type { NoteExportSettings } from "./settings";

// Page sizes in PDF points (1 pt = 1/72 inch)
const MM = 72 / 25.4;
const PAGE_FORMATS: Record<string, [number, number]> = {
  a4: [210 * MM, 297 * MM],
  a5: [148 * MM, 210 * MM],
  letter: [612, 792],
  legal: [612, 1008],
};
const PAGE_MARGIN = 15 * MM;
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
    const html = buildHtmlDocument(rendered, file.basename, settings);

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
//  PDF export (jsPDF + html2canvas)
// ─────────────────────────────────────────

export async function exportAsPdf(app: App, file: TFile, settings: NoteExportSettings): Promise<void> {
  const notice = new Notice("Generating PDF…", 0);
  let iframe: HTMLIFrameElement | null = null;
  try {
    const rendered = await renderNote(app, file, settings);
    const html = buildHtmlDocument(rendered, file.basename, settings);

    // Render in an isolated, off-screen iframe so the export theme
    // never leaks into Obsidian's own interface.
    iframe = document.body.createEl("iframe", { cls: "pdf-html-note-export-frame" });
    const loaded = new Promise<void>((resolve) => {
      iframe?.addEventListener("load", () => resolve(), { once: true });
    });
    iframe.srcdoc = html;
    await loaded;

    const frameDoc = iframe.contentDocument;
    const target = frameDoc?.querySelector<HTMLElement>(".ne-container");
    if (!frameDoc || !target) throw new Error("Could not prepare the rendering frame");

    // Let fonts and inline images settle
    await frameDoc.fonts?.ready;
    await sleep(200);

    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      width: RENDER_WIDTH_PX,
      windowWidth: RENDER_WIDTH_PX,
    });

    const [pageWidth, pageHeight] = PAGE_FORMATS[settings.pageSize] ?? PAGE_FORMATS.a4;
    const imgWidth = pageWidth - 2 * PAGE_MARGIN;
    const usableHeight = pageHeight - 2 * PAGE_MARGIN;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const pngBytes = await canvasToPng(canvas);
    const pdf = await PDFDocument.create();
    pdf.setTitle(file.basename);
    pdf.setCreator("PDF and HTML Note Export");
    const image = await pdf.embedPng(pngBytes);
    const white = rgb(1, 1, 1);

    const pageCount = Math.max(1, Math.ceil(imgHeight / usableHeight - 1e-6));
    for (let i = 0; i < pageCount; i++) {
      const page = pdf.addPage([pageWidth, pageHeight]);
      // pdf-lib uses a bottom-left origin: shift the long image up by one
      // usable page height per page, then mask the top and bottom margins.
      const imageTop = pageHeight - PAGE_MARGIN + i * usableHeight;
      page.drawImage(image, { x: PAGE_MARGIN, y: imageTop - imgHeight, width: imgWidth, height: imgHeight });
      page.drawRectangle({ x: 0, y: pageHeight - PAGE_MARGIN, width: pageWidth, height: PAGE_MARGIN, color: white });
      page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: PAGE_MARGIN, color: white });
    }
    const pdfBytes = await pdf.save();

    const folder = await ensureFolder(app, settings.exportFolder);
    const path = uniquePath(app, folder, file.basename, "pdf");
    await writeFile(app, path, pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength));

    notice.hide();
    new Notice(`PDF exported to ${path}`);
  } catch (e) {
    notice.hide();
    console.error("PDF and HTML Note Export: PDF export failed", e);
    new Notice(`PDF export failed: ${(e as Error).message}`);
  } finally {
    iframe?.remove();
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
