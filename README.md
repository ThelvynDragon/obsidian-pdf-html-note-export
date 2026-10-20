# PDF and HTML Note Export

Export your Obsidian notes as **PDF** or **self-contained HTML5** files with a clean, professional built-in theme. Works on desktop and Android.

## Features

- **Vector PDF export** — Real text with embedded fonts, vector backgrounds, borders and checkboxes, native images. Sharp at any zoom, 6 to 13 times smaller files and 3 to 4 times faster than a page snapshot in tests. Generated directly in JavaScript (pdf-lib): no print dialog, works on Android.
- **Clean page breaks** — Lines, images, table rows and headings are never cut between two pages; long code lines wrap.
- **Every script** — Latin, Greek and Cyrillic are drawn as vector text; emoji, Chinese, Japanese, Korean, Arabic, Hebrew, math and diagrams are drawn as small high-resolution images with an invisible text layer, so all text stays selectable, copyable and searchable.
- **Your colors** — Reuse the heading and accent colors of your Obsidian theme (adjusted for a white page), pick your own, or keep the neutral theme. Applies to PDF and HTML.
- **Image mode** — The 1.x behaviour (a picture of the rendered note, optional invisible text layer) remains available, and is used automatically as a fallback.
- **Clickable links & PDF outline** — External links stay clickable, links to headings in the same note jump inside the PDF, and headings appear as bookmarks in the PDF viewer's sidebar.
- **Standalone HTML5 export** — Produces a single HTML file with embedded CSS and base64 images. Opens on any device.
- **Built-in theme** — Clean, professional styling independent of your Obsidian theme.
- **Embedded images** — Vault images are automatically converted to base64 for fully self-contained exports.
- **Metadata header** — Title, export date, and frontmatter tags displayed at the top.
- **Custom CSS** — Add your own CSS overrides via plugin settings.
- **File menu integration** — Right-click any `.md` file → Export as PDF / HTML5.
- **Mobile friendly** — Files are saved directly in the vault, works reliably on Android.

## Installation

### From Community Plugins (recommended)

1. Open **Settings → Community plugins → Browse**.
2. Search for **"PDF HTML Note Export"**.
3. Click **Install**, then **Enable**.

### Manual installation

1. Download the latest release from [GitHub Releases](https://github.com/ThelvynDragon/obsidian-pdf-html-note-export/releases).
2. Extract `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/pdf-html-note-export/`.
3. Restart Obsidian and enable the plugin in Settings → Community plugins.

## Usage

### Commands (Ctrl/Cmd + P)

| Command | Description |
|---------|-------------|
| **Export current note in default format** | Exports using your default format (PDF or HTML) |
| **Export current note as PDF** | Generates a PDF in the export folder |
| **Export current note as HTML** | Generates a self-contained HTML file |

### Ribbon icon

The ⬇️ icon in the left ribbon exports the active note using the default format.

### File menu

Right-click any `.md` file in the file explorer → **Export as PDF** / **Export as HTML5**.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Default format | PDF or HTML5 | PDF |
| Page size | A4, A5, Letter, Legal | A4 |
| PDF rendering | Vector (sharp text, small files) or Image (exact snapshot) | Vector |
| Selectable text in PDF | Image mode: add an invisible text layer (select, copy, search) | On |
| Color scheme | Obsidian theme colors, Neutral, or Custom | Obsidian theme colors |
| Heading color / Accent color | Colors used by the Custom scheme | Violet |
| Include metadata | Show title and frontmatter in header | On |
| Include date | Show export date in header | On |
| Export folder | Vault folder for exported files | `exports` |
| Custom CSS | Additional styles appended to built-in theme | Empty |

## Export location

Exported files are saved inside your vault at `<vault>/exports/` (configurable). This ensures they work reliably on all platforms including Android, and are automatically synced if you use Obsidian Sync.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

### How the vector mode works

The note is rendered by Obsidian in an off-screen frame using the bundled fonts, with kerning and ligatures disabled so the browser layout and the PDF use exactly the same glyph advances. The plugin then walks the rendered page and redraws it with pdf-lib: each word at its exact position with the embedded font, backgrounds and borders as vector shapes (rounded corners included), images embedded natively. Page breaks are chosen between lines. Fonts are subset to the glyphs actually used, so each PDF only contains a few KB of font data.

Bundled fonts: Noto Sans and Noto Sans Mono (SIL Open Font License 1.1, see `fonts/OFL.txt`), subset to Latin, Greek, Cyrillic and common symbols by `scripts/make-fonts.py` (requires `fonttools`, output is byte-for-byte reproducible).

### How the invisible text layer works

In image mode, the PDF page is an image of the rendered note (html2canvas). On top of it, each word is written with text rendering mode 3 (invisible) at its exact position, using a 612-byte font with a single empty glyph (the same idea as Tesseract's "GlyphLessFont"). Each distinct character or emoji sequence gets its own code, and a per-PDF ToUnicode map restores the original text when copying or searching. The font is generated reproducibly by `scripts/make-glyphless-font.py` (requires `fonttools`).

## License

MIT. Bundled Noto fonts: SIL Open Font License 1.1 (`fonts/OFL.txt`).
