import { PDFDocument, PDFHexString, PDFRef, PDFString } from "pdf-lib";
import { GLYPHLESS_FONT_BASE64 } from "./glyphless-font";
import { toUnicodeCMap } from "./ttf";

/** Advance width of every glyph, in 1/1000 em. */
export const GLYPH_WIDTH = 500;

/**
 * Invisible-text font for the PDF text layer.
 *
 * The embedded font program has a single empty glyph; each distinct grapheme
 * (letter, CJK character, emoji sequence...) gets its own CID, and the
 * ToUnicode CMap maps every CID back to its exact text. Viewers therefore
 * copy and search the original text for any script, at a cost of a few
 * hundred bytes per PDF.
 */
export class GlyphLessTextFont {
  readonly ref: PDFRef;
  private readonly cids = new Map<string, number>();
  private readonly segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  constructor(private readonly pdf: PDFDocument) {
    this.ref = pdf.context.nextRef();
  }

  /** Splits text into graphemes and returns its CID string plus glyph count. */
  encode(text: string): { hex: PDFHexString; length: number } {
    const parts = this.segmenter ? Array.from(this.segmenter.segment(text), (g) => g.segment) : Array.from(text);
    let hex = "";
    for (const part of parts) {
      let cid = this.cids.get(part);
      if (cid === undefined) {
        cid = this.cids.size + 1; // CID 0 is reserved for .notdef
        if (cid > 0xffff) cid = 0;
        else this.cids.set(part, cid);
      }
      hex += cid.toString(16).padStart(4, "0");
    }
    return { hex: PDFHexString.of(hex), length: parts.length };
  }

  /** Writes the font objects. Call once, after all text has been encoded. */
  finalize(): void {
    const ctx = this.pdf.context;
    const fontBytes = base64ToBytes(GLYPHLESS_FONT_BASE64);

    const fontFile = ctx.flateStream(fontBytes, { Length1: fontBytes.length });
    const descriptor = ctx.obj({
      Type: "FontDescriptor",
      FontName: "GlyphLessFont",
      Flags: 4,
      FontBBox: [0, -200, GLYPH_WIDTH, 800],
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 800,
      StemV: 80,
      FontFile2: ctx.register(fontFile),
    });

    // Every CID is drawn with glyph 1 (the empty glyph)
    const count = this.cids.size + 1;
    const cidToGid = new Uint8Array(count * 2);
    for (let cid = 1; cid < count; cid++) cidToGid[cid * 2 + 1] = 1;

    const cidFont = ctx.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: "GlyphLessFont",
      CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
      FontDescriptor: ctx.register(descriptor),
      DW: GLYPH_WIDTH,
      CIDToGIDMap: ctx.register(ctx.flateStream(cidToGid)),
    });

    const type0 = ctx.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: "GlyphLessFont",
      Encoding: "Identity-H",
      DescendantFonts: [ctx.register(cidFont)],
      ToUnicode: ctx.register(ctx.flateStream(toUnicodeCMap(this.cids, true))),
    });
    ctx.assign(this.ref, type0);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = window.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
