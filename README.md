# PDF and HTML Note Export

Export your Obsidian notes as **PDF** or **self-contained HTML5** files with a clean, professional built-in theme. Works on desktop and Android.

## Features

- **PDF export** — Generates PDF directly in JavaScript (html2canvas + pdf-lib). No external dependencies, no print dialog.
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

## License

MIT
