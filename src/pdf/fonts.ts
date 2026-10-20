import { FONT_DATA } from "./fonts-data";
import { TrueTypeFont } from "./ttf";

export type FontKey = "sans-regular" | "sans-bold" | "sans-italic" | "sans-bolditalic" | "mono-regular" | "mono-bold";

export const SANS_FAMILY = "NE Sans";
export const MONO_FAMILY = "NE Mono";

const FACES: Record<FontKey, { family: string; weight: string; style: string; psName: string }> = {
  "sans-regular": { family: SANS_FAMILY, weight: "400", style: "normal", psName: "NotoSans-Regular" },
  "sans-bold": { family: SANS_FAMILY, weight: "700", style: "normal", psName: "NotoSans-Bold" },
  "sans-italic": { family: SANS_FAMILY, weight: "400", style: "italic", psName: "NotoSans-Italic" },
  "sans-bolditalic": { family: SANS_FAMILY, weight: "700", style: "italic", psName: "NotoSans-BoldItalic" },
  "mono-regular": { family: MONO_FAMILY, weight: "400", style: "normal", psName: "NotoSansMono-Regular" },
  "mono-bold": { family: MONO_FAMILY, weight: "700", style: "normal", psName: "NotoSansMono-Bold" },
};

export type FontSet = Record<FontKey, TrueTypeFont>;

let cache: Promise<FontSet> | null = null;

/** Decompresses and parses the bundled fonts (once per session). */
export function loadFonts(): Promise<FontSet> {
  cache ??= (async () => {
    const set = {} as FontSet;
    for (const key of Object.keys(FACES) as FontKey[]) {
      const bytes = await inflate(base64ToBytes(FONT_DATA[key]));
      set[key] = new TrueTypeFont(bytes, FACES[key].psName);
    }
    return set;
  })();
  cache.catch(() => (cache = null));
  return cache;
}

/** Makes the bundled fonts available to the export frame's layout engine. */
export async function registerFonts(doc: Document, fonts: FontSet): Promise<void> {
  const win = doc.defaultView;
  if (!win || !("FontFace" in win)) throw new Error("FontFace API not available");
  const FontFaceCtor = (win as unknown as { FontFace: typeof FontFace }).FontFace;
  for (const key of Object.keys(FACES) as FontKey[]) {
    const face = FACES[key];
    const bytes = fonts[key].bytes;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ff = new FontFaceCtor(face.family, buffer, { weight: face.weight, style: face.style });
    await ff.load();
    (doc.fonts as unknown as { add(face: FontFace): void }).add(ff);
  }
}

/** Picks the bundled font matching a computed style, or null if it is not one of ours. */
export function fontKeyFor(style: CSSStyleDeclaration): FontKey | null {
  const family = (style.fontFamily.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
  const bold = (parseInt(style.fontWeight, 10) || 400) >= 600;
  const italic = style.fontStyle !== "normal";
  if (family === MONO_FAMILY) return bold ? "mono-bold" : "mono-regular";
  if (family !== SANS_FAMILY) return null;
  if (bold) return italic ? "sans-bolditalic" : "sans-bold";
  return italic ? "sans-italic" : "sans-regular";
}

/** CSS that makes the export frame lay out text exactly as the PDF draws it. */
export const VECTOR_FRAME_CSS = `
:root {
  --ne-font-text: "${SANS_FAMILY}", sans-serif;
  --ne-font-mono: "${MONO_FAMILY}", monospace;
}
* {
  font-kerning: none !important;
  font-variant-ligatures: none !important;
  font-feature-settings: "kern" 0, "liga" 0, "calt" 0, "clig" 0 !important;
  font-synthesis: none !important;
}
pre, pre code {
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
}
.ne-vector-li {
  list-style: none !important;
  position: relative;
}
.ne-marker {
  position: absolute;
  right: 100%;
  margin-right: 0.45em;
  white-space: nowrap;
}
`;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = window.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
