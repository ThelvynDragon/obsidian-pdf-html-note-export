import { PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";

/**
 * Minimal TrueType reader, subsetter and PDF embedder.
 *
 * The bundled fonts have no OpenType layout tables, so text is simply one
 * glyph per code point (the export frame disables kerning and ligatures, so
 * browser layout and PDF output use exactly the same advances).
 * Subsetting keeps glyph IDs and empties unused glyphs, which is enough to
 * keep each embedded font to a few kilobytes.
 */
export class TrueTypeFont {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly bbox: [number, number, number, number];
  readonly italicAngle: number;
  readonly numGlyphs: number;
  private readonly cmap = new Map<number, number>();
  private readonly advances: Uint16Array;
  private readonly tables = new Map<string, { offset: number; length: number }>();
  private readonly view: DataView;

  constructor(readonly bytes: Uint8Array, readonly postScriptName: string) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = this.view;
    const numTables = v.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
      this.tables.set(tag, { offset: v.getUint32(rec + 8), length: v.getUint32(rec + 12) });
    }

    const head = this.table("head").offset;
    this.unitsPerEm = v.getUint16(head + 18);
    this.bbox = [v.getInt16(head + 36), v.getInt16(head + 38), v.getInt16(head + 40), v.getInt16(head + 42)];

    const hhea = this.table("hhea").offset;
    this.ascent = v.getInt16(hhea + 4);
    this.descent = v.getInt16(hhea + 6);
    const numberOfHMetrics = v.getUint16(hhea + 34);

    this.numGlyphs = v.getUint16(this.table("maxp").offset + 4);

    const os2 = this.tables.get("OS/2");
    this.capHeight = os2 && v.getUint16(os2.offset) >= 2 ? v.getInt16(os2.offset + 88) : this.ascent;

    const post = this.tables.get("post");
    this.italicAngle = post ? v.getInt32(post.offset + 4) / 65536 : 0;

    const hmtx = this.table("hmtx").offset;
    this.advances = new Uint16Array(this.numGlyphs);
    let last = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      if (g < numberOfHMetrics) last = v.getUint16(hmtx + g * 4);
      this.advances[g] = last;
    }

    this.readCmap();
  }

  has(codePoint: number): boolean {
    return this.cmap.has(codePoint);
  }

  glyph(codePoint: number): number {
    return this.cmap.get(codePoint) ?? 0;
  }

  advance(glyph: number): number {
    return this.advances[glyph] ?? 0;
  }

  private table(tag: string): { offset: number; length: number } {
    const t = this.tables.get(tag);
    if (!t) throw new Error(`Font table ${tag} missing`);
    return t;
  }

  private readCmap(): void {
    const v = this.view;
    const base = this.table("cmap").offset;
    const count = v.getUint16(base + 2);
    let best = -1;
    let bestFormat = 0;
    for (let i = 0; i < count; i++) {
      const rec = base + 4 + i * 8;
      const platform = v.getUint16(rec);
      const encoding = v.getUint16(rec + 2);
      const offset = base + v.getUint32(rec + 4);
      const format = v.getUint16(offset);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (unicode && (format === 12 || (format === 4 && bestFormat !== 12))) {
        best = offset;
        bestFormat = format;
      }
    }
    if (best < 0) return;

    if (bestFormat === 12) {
      const groups = v.getUint32(best + 12);
      for (let i = 0; i < groups; i++) {
        const g = best + 16 + i * 12;
        const start = v.getUint32(g);
        const end = v.getUint32(g + 4);
        const gid = v.getUint32(g + 8);
        for (let c = start; c <= end; c++) this.cmap.set(c, gid + c - start);
      }
      return;
    }

    const segCount = v.getUint16(best + 6) / 2;
    const ends = best + 14;
    const starts = ends + segCount * 2 + 2;
    const deltas = starts + segCount * 2;
    const rangeOffsets = deltas + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const start = v.getUint16(starts + s * 2);
      const end = v.getUint16(ends + s * 2);
      const delta = v.getInt16(deltas + s * 2);
      const ro = v.getUint16(rangeOffsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (ro === 0) gid = (c + delta) & 0xffff;
        else {
          const addr = rangeOffsets + s * 2 + ro + (c - start) * 2;
          gid = v.getUint16(addr);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) this.cmap.set(c, gid);
      }
    }
  }

  /** Returns a copy of the font where every glyph not in `keep` is empty. */
  subset(keep: Set<number>): Uint8Array {
    const v = this.view;
    const head = this.table("head").offset;
    const longLoca = v.getInt16(head + 50) === 1;
    const loca = this.table("loca").offset;
    const glyf = this.table("glyf").offset;
    const glyphRange = (g: number): [number, number] =>
      longLoca
        ? [v.getUint32(loca + g * 4), v.getUint32(loca + g * 4 + 4)]
        : [v.getUint16(loca + g * 2) * 2, v.getUint16(loca + g * 2 + 2) * 2];

    // Add components of composite glyphs
    const queue = [0, ...keep];
    const kept = new Set<number>();
    while (queue.length > 0) {
      const g = queue.pop() as number;
      if (kept.has(g) || g >= this.numGlyphs) continue;
      kept.add(g);
      const [start, end] = glyphRange(g);
      if (end <= start || v.getInt16(glyf + start) >= 0) continue;
      let p = glyf + start + 10;
      for (;;) {
        const flags = v.getUint16(p);
        queue.push(v.getUint16(p + 2));
        p += 4 + (flags & 0x0001 ? 4 : 2);
        if (flags & 0x0008) p += 2;
        else if (flags & 0x0040) p += 4;
        else if (flags & 0x0080) p += 8;
        if (!(flags & 0x0020)) break;
      }
    }

    // New glyf + long loca
    const parts: Uint8Array[] = [];
    const newLoca = new Uint8Array((this.numGlyphs + 1) * 4);
    const locaView = new DataView(newLoca.buffer);
    let size = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      locaView.setUint32(g * 4, size);
      if (!kept.has(g)) continue;
      const [start, end] = glyphRange(g);
      if (end <= start) continue;
      const len = (end - start + 3) & ~3;
      const data = new Uint8Array(len);
      data.set(this.bytes.subarray(glyf + start, glyf + end));
      parts.push(data);
      size += len;
    }
    locaView.setUint32(this.numGlyphs * 4, size);
    const newGlyf = new Uint8Array(size);
    let pos = 0;
    for (const part of parts) {
      newGlyf.set(part, pos);
      pos += part.length;
    }

    const out = new Map<string, Uint8Array>();
    for (const [tag, t] of this.tables) {
      if (tag === "glyf" || tag === "loca" || tag === "DSIG") continue;
      out.set(tag, this.bytes.slice(t.offset, t.offset + t.length));
    }
    out.set("glyf", newGlyf);
    out.set("loca", newLoca);
    const newHead = out.get("head") as Uint8Array;
    const hv = new DataView(newHead.buffer);
    hv.setInt16(50, 1); // long loca
    hv.setUint32(8, 0); // checkSumAdjustment, fixed below
    return writeSfnt(out);
  }
}

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array((data.length + 3) & ~3);
  padded.set(data);
  const v = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

function writeSfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = Array.from(tables.keys()).sort();
  const n = tags.length;
  let offset = 12 + n * 16;
  let total = offset;
  for (const tag of tags) total += ((tables.get(tag) as Uint8Array).length + 3) & ~3;

  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  let pow = 1;
  while (pow * 2 <= n) pow *= 2;
  v.setUint32(0, 0x00010000);
  v.setUint16(4, n);
  v.setUint16(6, pow * 16);
  v.setUint16(8, Math.log2(pow));
  v.setUint16(10, n * 16 - pow * 16);

  let headOffset = 0;
  tags.forEach((tag, i) => {
    const data = tables.get(tag) as Uint8Array;
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = tag.charCodeAt(k);
    v.setUint32(rec + 4, checksum(data));
    v.setUint32(rec + 8, offset);
    v.setUint32(rec + 12, data.length);
    out.set(data, offset);
    if (tag === "head") headOffset = offset;
    offset += (data.length + 3) & ~3;
  });
  v.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** A TrueType font embedded in a PDF as a Type0 / CIDFontType2 font. */
export class EmbeddedFont {
  readonly ref: PDFRef;
  private readonly used = new Map<number, string>();

  constructor(private readonly pdf: PDFDocument, readonly font: TrueTypeFont, private readonly tag: string) {
    this.ref = pdf.context.nextRef();
  }

  /** Encodes text as glyph IDs; returns the hex string and its width in em units. */
  encode(text: string): { hex: PDFHexString; width: number } {
    let hex = "";
    let width = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      const gid = this.font.glyph(cp);
      if (!this.used.has(gid)) this.used.set(gid, ch);
      width += this.font.advance(gid);
      hex += gid.toString(16).padStart(4, "0");
    }
    return { hex: PDFHexString.of(hex), width: width / this.font.unitsPerEm };
  }

  finalize(): void {
    const ctx = this.pdf.context;
    const f = this.font;
    const k = 1000 / f.unitsPerEm;
    const subset = f.subset(new Set(this.used.keys()));
    const name = `${this.tag}+${f.postScriptName}`;
    const italic = f.italicAngle !== 0;

    const descriptor = ctx.obj({
      Type: "FontDescriptor",
      FontName: name,
      Flags: 32 | (italic ? 64 : 0),
      FontBBox: f.bbox.map((n) => Math.round(n * k)),
      ItalicAngle: f.italicAngle,
      Ascent: Math.round(f.ascent * k),
      Descent: Math.round(f.descent * k),
      CapHeight: Math.round(f.capHeight * k),
      StemV: 80,
      FontFile2: ctx.register(ctx.flateStream(subset, { Length1: subset.length })),
    });

    const gids = Array.from(this.used.keys()).sort((a, b) => a - b);
    const widths: (number | number[])[] = [];
    for (const gid of gids) widths.push(gid, [Math.round(f.advance(gid) * k)]);

    const cidFont = ctx.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: name,
      CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
      FontDescriptor: ctx.register(descriptor),
      W: widths,
      CIDToGIDMap: PDFName.of("Identity"),
    });

    ctx.assign(
      this.ref,
      ctx.obj({
        Type: "Font",
        Subtype: "Type0",
        BaseFont: name,
        Encoding: "Identity-H",
        DescendantFonts: [ctx.register(cidFont)],
        ToUnicode: ctx.register(ctx.flateStream(toUnicodeCMap(this.used))),
      })
    );
  }
}

/** Builds a ToUnicode CMap mapping 2-byte codes to text. */
export function toUnicodeCMap(map: Map<number, string> | Map<string, number>, reversed = false): string {
  const entries: [number, string][] = reversed
    ? Array.from((map as Map<string, number>).entries(), ([text, code]) => [code, text])
    : Array.from((map as Map<number, string>).entries());
  const lines = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [code, text] of chunk) {
      let hex = "";
      for (let j = 0; j < text.length; j++) hex += text.charCodeAt(j).toString(16).padStart(4, "0");
      lines.push(`<${code.toString(16).padStart(4, "0")}> <${hex}>`);
    }
    lines.push("endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return lines.join("\n");
}
