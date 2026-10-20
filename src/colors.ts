import type { NoteExportSettings } from "./settings";

type Rgb = [number, number, number];

/**
 * Returns CSS custom properties overriding the export theme colors, based on
 * the chosen color scheme. Colors are adjusted so they stay readable on the
 * white page, even when they come from a dark Obsidian theme.
 */
export function buildColorCss(settings: NoteExportSettings, doc: Document = activeDocument): string {
  if (settings.colorScheme === "builtin") return "";

  let accent: Rgb | null;
  const headings: (Rgb | null)[] = [];

  if (settings.colorScheme === "custom") {
    accent = parseCssColor(settings.accentColor);
    const heading = parseCssColor(settings.headingColor);
    for (let i = 0; i < 6; i++) headings.push(i < 4 ? heading : null);
  } else {
    const probe = probeTheme(doc);
    accent = probe.accent;
    probe.headings.forEach((h, i) => {
      const themed = h && probe.text && !sameRgb(h, probe.text) ? h : null;
      // Headings in plain text color: use the accent (h5/h6 stay muted)
      headings.push(themed ?? (i < 4 ? accent : null));
    });
  }
  if (!accent) return "";

  const vars: string[] = [];
  const accentHex = toHex(ensureContrast(accent, 3));
  vars.push(`--ne-color-accent: ${accentHex}`, `--ne-color-link: ${toHex(ensureContrast(accent, 4.5))}`);
  vars.push(`--ne-color-tag-text: ${toHex(ensureContrast(accent, 5))}`, `--ne-color-tag-bg: ${toHex(mix(accent, [255, 255, 255], 0.88))}`);
  headings.forEach((h, i) => {
    if (h) vars.push(`--ne-color-h${i + 1}: ${toHex(ensureContrast(h, i < 2 ? 3 : 4.5))}`);
  });
  return `:root {\n  ${vars.join(";\n  ")};\n}`;
}

function probeTheme(doc: Document): { accent: Rgb | null; text: Rgb | null; headings: (Rgb | null)[] } {
  const host = doc.body.createDiv({ cls: "markdown-rendered pdf-html-note-export-probe" });
  try {
    const win = doc.defaultView ?? window;
    const colorOf = (el: Element): Rgb | null => parseCssColor(win.getComputedStyle(el).color);
    const accentEl = host.createSpan({ cls: "pdf-html-note-export-accent" });
    const headings = [1, 2, 3, 4, 5, 6].map((n) => colorOf(host.createEl(`h${n}` as keyof HTMLElementTagNameMap, { text: "Heading" })));
    return { accent: colorOf(accentEl), text: colorOf(host), headings };
  } finally {
    host.remove();
  }
}

function parseCssColor(value: string): Rgb | null {
  const v = value.trim();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v);
  if (h) {
    const hex = h[1].length === 3 ? h[1].split("").map((c) => c + c).join("") : h[1];
    return [0, 2, 4].map((i) => parseInt(hex.substring(i, i + 2), 16)) as Rgb;
  }
  return null;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Darkens a color until its contrast ratio against white reaches `min`. */
function ensureContrast(c: Rgb, min: number): Rgb {
  let out = c;
  for (let i = 0; i < 20 && 1.05 / (luminance(out) + 0.05) < min; i++) out = mix(out, [0, 0, 0], 0.1);
  return out;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;
}

function sameRgb(a: Rgb, b: Rgb): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) < 2);
}

function toHex(c: Rgb): string {
  return "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}
