import { App, MarkdownRenderer, Component, TFile, normalizePath } from "obsidian";
import { EXPORT_CSS } from "./styles";
import type { NoteExportSettings } from "./settings";

/**
 * Renders a note into a detached DOM element using Obsidian's own
 * MarkdownRenderer (callouts, embeds and other plugins' syntax are supported).
 * Vault images are inlined as base64 data URIs.
 */
export async function renderNote(
  app: App,
  file: TFile,
  settings: NoteExportSettings
): Promise<HTMLElement> {
  const content = await app.vault.cachedRead(file);
  const metadata = app.metadataCache.getFileCache(file);

  const root = createDiv();
  if (settings.includeMetadata) {
    buildMetadataHeader(root, file, metadata, settings);
  }

  const body = root.createDiv({ cls: "markdown-preview-view" });

  // Dedicated component so that render children are released after export
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, content, body, file.path, component);
    await embedImages(app, body, file);
  } finally {
    component.unload();
  }

  return root;
}

/**
 * Builds a complete standalone HTML5 document from a rendered note.
 */
export function buildHtmlDocument(
  rendered: HTMLElement,
  title: string,
  settings: NoteExportSettings,
  extraCss = ""
): string {
  const customCss = settings.customCssSnippet
    ? `\n  <style>\n${settings.customCssSnippet}\n  </style>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${EXPORT_CSS}
${extraCss}
  </style>${customCss}
</head>
<body>
  <div class="ne-container">
${rendered.outerHTML}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (m) => map[m] ?? m);
}

async function embedImages(app: App, container: HTMLElement, sourceFile: TFile): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));

  for (const img of images) {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) {
      continue;
    }

    try {
      let imagePath = src;
      const match = src.match(/^app:\/\/[^/]+\/(.+?)(\?.*)?$/);
      if (match) {
        imagePath = decodeURIComponent(match[1]);
      }

      // Resolve as a vault link, then as an exact vault path
      let imageFile = app.metadataCache.getFirstLinkpathDest(imagePath, sourceFile.path);
      if (!imageFile) {
        const direct = app.vault.getAbstractFileByPath(normalizePath(imagePath));
        imageFile = direct instanceof TFile ? direct : null;
      }

      if (imageFile) {
        const buffer = await app.vault.readBinary(imageFile);
        img.setAttribute("src", `data:${getMimeType(imageFile.extension)};base64,${arrayBufferToBase64(buffer)}`);
      }
    } catch (e) {
      console.warn(`PDF and HTML Note Export: could not embed image ${src}`, e);
    }
  }
}

function buildMetadataHeader(
  root: HTMLElement,
  file: TFile,
  metadata: ReturnType<App["metadataCache"]["getFileCache"]>,
  settings: NoteExportSettings
): void {
  const header = root.createDiv({ cls: "ne-metadata" });
  header.createDiv({ cls: "ne-title", text: file.basename });

  if (settings.includeDate) {
    const dateStr = new Date().toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    header.createDiv({ cls: "ne-date", text: `Exported on ${dateStr}` });
  }

  const rawTags: unknown = metadata?.frontmatter?.tags;
  const tags = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
  if (tags.length > 0) {
    const tagsEl = header.createDiv({ cls: "ne-tags" });
    for (const tag of tags) {
      tagsEl.createSpan({ cls: "tag", text: `#${String(tag)}` });
      tagsEl.appendText(" ");
    }
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
  };
  return mimeTypes[extension.toLowerCase()] ?? "image/png";
}
