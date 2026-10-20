import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type NoteExportPlugin from "./main";

export type ExportFormat = "pdf" | "html";
export type PageSize = "a4" | "a5" | "letter" | "legal";
export type PdfMode = "vector" | "image";
export type ColorScheme = "obsidian" | "builtin" | "custom";

export interface NoteExportSettings {
  defaultFormat: ExportFormat;
  pageSize: PageSize;
  pdfMode: PdfMode;
  selectableText: boolean;
  colorScheme: ColorScheme;
  headingColor: string;
  accentColor: string;
  includeMetadata: boolean;
  includeDate: boolean;
  customCssSnippet: string;
  exportFolder: string;
}

export const DEFAULT_SETTINGS: NoteExportSettings = {
  defaultFormat: "pdf",
  pageSize: "a4",
  pdfMode: "vector",
  selectableText: true,
  colorScheme: "obsidian",
  headingColor: "#6d28d9",
  accentColor: "#7c3aed",
  includeMetadata: true,
  includeDate: true,
  customCssSnippet: "",
  exportFolder: "exports",
};

const FORMAT_OPTIONS: Record<ExportFormat, string> = { pdf: "PDF", html: "HTML" };
const PAGE_OPTIONS: Record<PageSize, string> = { a4: "A4", a5: "A5", letter: "Letter", legal: "Legal" };
const MODE_OPTIONS: Record<PdfMode, string> = {
  vector: "Vector (sharp text, small files)",
  image: "Image (exact snapshot of the page)",
};
const COLOR_OPTIONS: Record<ColorScheme, string> = {
  obsidian: "Obsidian theme colors",
  builtin: "Neutral",
  custom: "Custom",
};

const TEXT = {
  defaultFormat: "Format used by the ribbon icon and the default-format command.",
  pageSize: "Page size for PDF export.",
  pdfMode:
    "Vector draws real text, shapes and images: sharp at any zoom, smaller files, clean page breaks. " +
    "Image takes a picture of the rendered note (the 1.x behaviour). Vector falls back to image automatically if something fails.",
  selectableText: "Image mode only: add an invisible text layer so PDF text can be selected, copied and searched.",
  colorScheme:
    "Obsidian theme colors reuses the heading and accent colors of your current theme (adjusted for a white page). " +
    "Applies to PDF and HTML exports.",
  headingColor: "Heading color when the color scheme is Custom.",
  accentColor: "Accent color (links, heading rule, quote bar, tags, checkboxes) when the color scheme is Custom.",
  includeMetadata: "Add title and frontmatter tags as a document header.",
  includeDate: "Add the export date in the document header.",
  exportFolder: "Folder in the vault where exported files are saved. Created automatically if it does not exist.",
  customCss: "Additional CSS applied after the built-in export theme.",
};

export class NoteExportSettingTab extends PluginSettingTab {
  plugin: NoteExportPlugin;

  constructor(app: App, plugin: NoteExportPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings (Obsidian 1.13+): rendered by Obsidian and
   * indexed by the settings search. display() remains as a fallback.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const d = DEFAULT_SETTINGS;
    return [
      {
        name: "Default format",
        desc: TEXT.defaultFormat,
        control: { type: "dropdown", key: "defaultFormat", defaultValue: d.defaultFormat, options: FORMAT_OPTIONS },
      },
      {
        name: "Page size",
        desc: TEXT.pageSize,
        control: { type: "dropdown", key: "pageSize", defaultValue: d.pageSize, options: PAGE_OPTIONS },
      },
      {
        name: "PDF rendering",
        desc: TEXT.pdfMode,
        control: { type: "dropdown", key: "pdfMode", defaultValue: d.pdfMode, options: MODE_OPTIONS },
      },
      {
        name: "Selectable text in PDF",
        desc: TEXT.selectableText,
        control: { type: "toggle", key: "selectableText", defaultValue: d.selectableText },
      },
      {
        name: "Color scheme",
        desc: TEXT.colorScheme,
        control: { type: "dropdown", key: "colorScheme", defaultValue: d.colorScheme, options: COLOR_OPTIONS },
      },
      {
        name: "Heading color",
        desc: TEXT.headingColor,
        control: { type: "color", key: "headingColor", defaultValue: d.headingColor },
      },
      {
        name: "Accent color",
        desc: TEXT.accentColor,
        control: { type: "color", key: "accentColor", defaultValue: d.accentColor },
      },
      {
        name: "Include metadata",
        desc: TEXT.includeMetadata,
        control: { type: "toggle", key: "includeMetadata", defaultValue: d.includeMetadata },
      },
      {
        name: "Include date",
        desc: TEXT.includeDate,
        control: { type: "toggle", key: "includeDate", defaultValue: d.includeDate },
      },
      {
        name: "Export folder",
        desc: TEXT.exportFolder,
        control: { type: "folder", key: "exportFolder", defaultValue: d.exportFolder, placeholder: "Folder path" },
      },
      {
        name: "Custom CSS",
        desc: TEXT.customCss,
        control: {
          type: "textarea",
          key: "customCssSnippet",
          defaultValue: d.customCssSnippet,
          placeholder: "Your custom CSS rules",
          rows: 6,
        },
      },
    ];
  }

  /** Fallback for Obsidian versions older than 1.13. */
  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    const save = async (refresh = false): Promise<void> => {
      await this.plugin.saveSettings();
      if (refresh) this.display();
    };

    new Setting(containerEl)
      .setName("Default format")
      .setDesc(TEXT.defaultFormat)
      .addDropdown((dd) =>
        dd.addOptions(FORMAT_OPTIONS).setValue(s.defaultFormat).onChange(async (v) => {
          s.defaultFormat = v as ExportFormat;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Page size")
      .setDesc(TEXT.pageSize)
      .addDropdown((dd) =>
        dd.addOptions(PAGE_OPTIONS).setValue(s.pageSize).onChange(async (v) => {
          s.pageSize = v as PageSize;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("PDF rendering")
      .setDesc(TEXT.pdfMode)
      .addDropdown((dd) =>
        dd.addOptions(MODE_OPTIONS).setValue(s.pdfMode).onChange(async (v) => {
          s.pdfMode = v as PdfMode;
          await save(true);
        })
      );

    if (s.pdfMode === "image") {
      new Setting(containerEl)
        .setName("Selectable text in PDF")
        .setDesc(TEXT.selectableText)
        .addToggle((t) =>
          t.setValue(s.selectableText).onChange(async (v) => {
            s.selectableText = v;
            await save();
          })
        );
    }

    new Setting(containerEl)
      .setName("Color scheme")
      .setDesc(TEXT.colorScheme)
      .addDropdown((dd) =>
        dd.addOptions(COLOR_OPTIONS).setValue(s.colorScheme).onChange(async (v) => {
          s.colorScheme = v as ColorScheme;
          await save(true);
        })
      );

    if (s.colorScheme === "custom") {
      new Setting(containerEl)
        .setName("Heading color")
        .setDesc(TEXT.headingColor)
        .addColorPicker((c) =>
          c.setValue(s.headingColor).onChange(async (v) => {
            s.headingColor = v;
            await save();
          })
        );
      new Setting(containerEl)
        .setName("Accent color")
        .setDesc(TEXT.accentColor)
        .addColorPicker((c) =>
          c.setValue(s.accentColor).onChange(async (v) => {
            s.accentColor = v;
            await save();
          })
        );
    }

    new Setting(containerEl)
      .setName("Include metadata")
      .setDesc(TEXT.includeMetadata)
      .addToggle((t) =>
        t.setValue(s.includeMetadata).onChange(async (v) => {
          s.includeMetadata = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Include date")
      .setDesc(TEXT.includeDate)
      .addToggle((t) =>
        t.setValue(s.includeDate).onChange(async (v) => {
          s.includeDate = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Export folder")
      .setDesc(TEXT.exportFolder)
      .addText((t) =>
        t.setPlaceholder("Folder path").setValue(s.exportFolder).onChange(async (v) => {
          s.exportFolder = v.trim() || "exports";
          await save();
        })
      );

    new Setting(containerEl)
      .setClass("pdf-html-note-export-css-setting")
      .setName("Custom CSS")
      .setDesc(TEXT.customCss)
      .addTextArea((t) =>
        t.setPlaceholder("Your custom CSS rules").setValue(s.customCssSnippet).onChange(async (v) => {
          s.customCssSnippet = v;
          await save();
        })
      );
  }
}
