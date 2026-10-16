import { Plugin, TFile, Notice } from "obsidian";
import { NoteExportSettings, DEFAULT_SETTINGS, NoteExportSettingTab, ExportFormat } from "./settings";
import { exportAsHtml, exportAsPdf } from "./exporters";

export default class NoteExportPlugin extends Plugin {
  settings: NoteExportSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("file-down", "Export note", () => {
      const file = this.getActiveMarkdownFile();
      if (!file) {
        new Notice("No active note to export.");
        return;
      }
      void this.exportNote(file, this.settings.defaultFormat);
    });

    this.addCommand({
      id: "export-pdf",
      name: "Export current note as PDF",
      checkCallback: (checking) => this.runOnActiveFile(checking, "pdf"),
    });

    this.addCommand({
      id: "export-html",
      name: "Export current note as HTML",
      checkCallback: (checking) => this.runOnActiveFile(checking, "html"),
    });

    this.addCommand({
      id: "export-default",
      name: "Export current note in default format",
      checkCallback: (checking) => this.runOnActiveFile(checking, this.settings.defaultFormat),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;

        menu.addItem((item) =>
          item
            .setTitle("Export as PDF")
            .setIcon("file-down")
            .onClick(() => this.exportNote(file, "pdf"))
        );

        menu.addItem((item) =>
          item
            .setTitle("Export as HTML")
            .setIcon("file-code")
            .onClick(() => this.exportNote(file, "html"))
        );
      })
    );

    this.addSettingTab(new NoteExportSettingTab(this.app, this));
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === "md" ? file : null;
  }

  private runOnActiveFile(checking: boolean, format: ExportFormat): boolean {
    const file = this.getActiveMarkdownFile();
    if (!file) return false;
    if (!checking) void this.exportNote(file, format);
    return true;
  }

  private async exportNote(file: TFile, format: ExportFormat): Promise<void> {
    if (format === "html") {
      await exportAsHtml(this.app, file, this.settings);
    } else {
      await exportAsPdf(this.app, file, this.settings);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<NoteExportSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
