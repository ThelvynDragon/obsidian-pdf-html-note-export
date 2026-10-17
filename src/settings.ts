import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type NoteExportPlugin from "./main";

export type ExportFormat = "pdf" | "html";
export type PageSize = "a4" | "a5" | "letter" | "legal";

export interface NoteExportSettings {
  defaultFormat: ExportFormat;
  pageSize: PageSize;
  includeMetadata: boolean;
  includeDate: boolean;
  selectableText: boolean;
  customCssSnippet: string;
  exportFolder: string;
}

export const DEFAULT_SETTINGS: NoteExportSettings = {
  defaultFormat: "pdf",
  pageSize: "a4",
  includeMetadata: true,
  includeDate: true,
  selectableText: true,
  customCssSnippet: "",
  exportFolder: "exports",
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
    return [
      {
        name: "Default format",
        desc: "Format used by the ribbon icon and the default-format command.",
        control: {
          type: "dropdown",
          key: "defaultFormat",
          defaultValue: DEFAULT_SETTINGS.defaultFormat,
          options: { pdf: "PDF", html: "HTML" },
        },
      },
      {
        name: "Page size",
        desc: "Page size for PDF export.",
        control: {
          type: "dropdown",
          key: "pageSize",
          defaultValue: DEFAULT_SETTINGS.pageSize,
          options: { a4: "A4", a5: "A5", letter: "Letter", legal: "Legal" },
        },
      },
      {
        name: "Selectable text in PDF",
        desc: "Add an invisible text layer so PDF text can be selected, copied and searched.",
        control: { type: "toggle", key: "selectableText", defaultValue: DEFAULT_SETTINGS.selectableText },
      },
      {
        name: "Include metadata",
        desc: "Add title and frontmatter tags as a document header.",
        control: { type: "toggle", key: "includeMetadata", defaultValue: DEFAULT_SETTINGS.includeMetadata },
      },
      {
        name: "Include date",
        desc: "Add the export date in the document header.",
        control: { type: "toggle", key: "includeDate", defaultValue: DEFAULT_SETTINGS.includeDate },
      },
      {
        name: "Export folder",
        desc: "Folder in the vault where exported files are saved. Created automatically if it does not exist.",
        control: {
          type: "folder",
          key: "exportFolder",
          defaultValue: DEFAULT_SETTINGS.exportFolder,
          placeholder: "Folder path",
        },
      },
      {
        name: "Custom CSS",
        desc: "Additional CSS applied after the built-in export theme.",
        control: {
          type: "textarea",
          key: "customCssSnippet",
          defaultValue: DEFAULT_SETTINGS.customCssSnippet,
          placeholder: "Your custom CSS rules",
          rows: 6,
        },
      },
    ];
  }

  /** Fallback for Obsidian versions older than 1.13. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Default export format ---
    new Setting(containerEl)
      .setName("Default format")
      .setDesc("Format used by the quick export command.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("pdf", "PDF")
          .addOption("html", "HTML")
          .setValue(this.plugin.settings.defaultFormat)
          .onChange(async (value) => {
            this.plugin.settings.defaultFormat = value as ExportFormat;
            await this.plugin.saveSettings();
          })
      );

    // --- Page Size ---
    new Setting(containerEl)
      .setName("Page size")
      .setDesc("Page size for PDF export.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("a4", "A4")
          .addOption("a5", "A5")
          .addOption("letter", "Letter")
          .addOption("legal", "Legal")
          .setValue(this.plugin.settings.pageSize)
          .onChange(async (value) => {
            this.plugin.settings.pageSize = value as PageSize;
            await this.plugin.saveSettings();
          })
      );

    // --- Selectable text ---
    new Setting(containerEl)
      .setName("Selectable text in PDF")
      .setDesc("Add an invisible text layer so PDF text can be selected, copied and searched.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.selectableText).onChange(async (value) => {
          this.plugin.settings.selectableText = value;
          await this.plugin.saveSettings();
        })
      );

    // --- Include metadata ---
    new Setting(containerEl)
      .setName("Include metadata")
      .setDesc("Add title and frontmatter properties as a document header.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeMetadata)
          .onChange(async (value) => {
            this.plugin.settings.includeMetadata = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Include date ---
    new Setting(containerEl)
      .setName("Include date")
      .setDesc("Add export date in the document header.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeDate)
          .onChange(async (value) => {
            this.plugin.settings.includeDate = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Export folder ---
    new Setting(containerEl)
      .setName("Export folder")
      .setDesc(
        "Folder in the vault where exported files will be saved. " +
        "Created automatically if it does not exist."
      )
      .addText((text) =>
        text
          .setPlaceholder("Folder path")
          .setValue(this.plugin.settings.exportFolder)
          .onChange(async (value) => {
            this.plugin.settings.exportFolder = value.trim() || "exports";
            await this.plugin.saveSettings();
          })
      );

    // --- Custom CSS snippet ---
    new Setting(containerEl)
      .setClass("pdf-html-note-export-css-setting")
      .setName("Custom CSS")
      .setDesc("Additional CSS applied after the built-in export theme.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Your custom CSS rules")
          .setValue(this.plugin.settings.customCssSnippet)
          .onChange(async (value) => {
            this.plugin.settings.customCssSnippet = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
