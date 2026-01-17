import {
  App,
  BasesPropertyId,
  Modal,
  TFile,
  normalizePath,
  parsePropertyId,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import * as logger from "./logger";
import { formatDateTimeForFrontmatter } from "./utils";

export interface NewEventServiceConfig {
  app: App;
  startProperty?: BasesPropertyId | null;
  endProperty?: BasesPropertyId | null;
  allDayProperty?: BasesPropertyId | null;
  folderPath?: string | null;
  templatePath?: string | null;
  useEndDuration?: boolean;
  defaultDuration?: number;
  additionalFrontmatter?: Record<string, any>;
}

export class NewEventService {
  private config: NewEventServiceConfig;
  private modalInput: HTMLInputElement | null = null;
  private focusInterval: number | null = null;

  constructor(config: NewEventServiceConfig) {
    this.config = config;
  }

  updateConfig(config: NewEventServiceConfig) {
    this.config = { ...this.config, ...config };
  }

  async createEvent(start: Date, end: Date, frontmatterOverrides?: Record<string, any>): Promise<TFile | null> {
    try {
      const title = await this.promptForTitle();
      if (!title || !title.trim()) {
        return null;
      }

      const safeTitle = title.trim();

      // Extract tags from title
      const { cleanTitle, tags } = this.extractTags(safeTitle);

      // Resolve tags (handle sub-level tags and prompt user if needed)
      const resolvedTags = await this.resolveTags(tags);
      if (resolvedTags === null) {
        // User cancelled tag selection
        return null;
      }

      // Check if event is in the past
      let finalOverrides = frontmatterOverrides ? { ...frontmatterOverrides } : {};
      if (end < new Date()) {
        const choice = await this.promptForPastEvent();
        if (choice === "cancel") return null;
        if (choice === "complete") {
          finalOverrides.status = "complete";
          logger.log("Past event marked as complete. Overrides:", finalOverrides);
        }
      }

      const folderPath = this.resolveFolderPath();

      // Ensure folder exists
      await this.ensureFolderExists(folderPath);

      const path = this.buildUniquePath(folderPath, cleanTitle, start);
      const template = await this.loadTemplate(this.config.templatePath);
      const frontmatter = this.buildFrontmatter(cleanTitle, start, end, resolvedTags, finalOverrides);

      if (template) {
        const file = await this.config.app.vault.create(path, template);

        // Use processFrontMatter to add event fields while preserving template formatting
        await this.config.app.fileManager.processFrontMatter(file, (fm) => {
          // Delete template's title first to ensure ours takes precedence
          delete fm.title;
          Object.assign(fm, frontmatter);
        });

        return file;
      } else {
        // No template - create with basic frontmatter
        const content = this.buildNoteContent(null, frontmatter);
        const file = await this.config.app.vault.create(path, content);
        return file;
      }
    } catch (error) {
      logger.error('[NewEventService] Error creating event:', error);
      throw error;
    }
  }

  private extractTags(title: string): { cleanTitle: string; tags: string[] } {
    const tagRegex = /#([a-zA-Z0-9_/-]+)/g;
    const tags: string[] = [];
    let match;

    while ((match = tagRegex.exec(title)) !== null) {
      tags.push(match[1]); // Extract tag without the # symbol
    }

    // Remove tags from title
    const cleanTitle = title.replace(tagRegex, '').trim().replace(/\s+/g, ' ');

    return { cleanTitle, tags };
  }

  private async resolveTags(tags: string[]): Promise<string[] | null> {
    if (tags.length === 0) {
      return [];
    }

    const resolvedTags: string[] = [];

    for (const tag of tags) {
      const resolved = await this.resolveTag(tag);
      if (resolved === null) {
        // User cancelled
        return null;
      }
      resolvedTags.push(resolved);
    }

    return resolvedTags;
  }

  private async resolveTag(tag: string): Promise<string | null> {
    // Get all tags from the vault
    const metadataCache = this.config.app.metadataCache;
    const allTags = (metadataCache as any).getTags();

    // Find matching tags (exact match or sub-level matches)
    const exactMatch = `#${tag}`;
    const subLevelMatches: string[] = [];

    for (const existingTag in allTags) {
      // Check if it's a sub-level match (e.g., #example1/test matches #test)
      if (existingTag.endsWith(`/${tag}`)) {
        subLevelMatches.push(existingTag.substring(1)); // Remove leading #
      } else if (existingTag === exactMatch) {
        // Exact match exists
        return tag;
      }
    }

    // If no sub-level matches, return the tag as-is
    if (subLevelMatches.length === 0) {
      return tag;
    }

    // If exactly one sub-level match, use it automatically
    if (subLevelMatches.length === 1) {
      return subLevelMatches[0];
    }

    // If multiple sub-level matches, prompt user to choose
    return await this.promptForTagSelection(tag, subLevelMatches);
  }

  private async promptForTagSelection(
    originalTag: string,
    matches: string[]
  ): Promise<string | null> {
    const service = this;
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: `Select tag for #${originalTag}` });
          contentEl.createEl("p", {
            text: "Multiple matching tags found. Please select one:",
            cls: "setting-item-description",
          });

          const buttonContainer = contentEl.createDiv({ cls: "tag-selection-container" });
          buttonContainer.style.display = "flex";
          buttonContainer.style.flexDirection = "column";
          buttonContainer.style.gap = "8px";
          buttonContainer.style.marginTop = "16px";

          matches.forEach((match) => {
            const btn = buttonContainer.createEl("button", {
              text: `#${match}`,
              cls: "mod-cta",
            });
            btn.style.padding = "8px 16px";
            btn.style.textAlign = "left";
            btn.addEventListener("click", () => {
              resolve(match);
              this.close();
            });
          });

          const cancelBtn = contentEl.createEl("button", {
            text: "Cancel",
            cls: "mod-warning",
          });
          cancelBtn.style.marginTop = "16px";
          cancelBtn.addEventListener("click", () => {
            resolve(null);
            this.close();
          });

          this.onClose = () => {
            this.contentEl.empty();
          };
        }
      })(this.config.app);
      modal.open();
    });
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (!folderPath || folderPath === '/') return;

    const folder = this.config.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {

      await this.config.app.vault.createFolder(folderPath);
    }
  }

  ensureFocus() {
    if (!this.modalInput) return;
    this.applyFocus();
  }

  private resolveFolderPath(): string {
    const folder = this.config.folderPath?.trim();
    if (folder) {
      return normalizePath(folder);
    }
    return this.config.app.vault.getRoot().path;
  }

  private async promptForTitle(): Promise<string | undefined> {
    const service = this;
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          const form = contentEl.createEl("form", {
            attr: { autocomplete: "off" },
          });
          form.createEl("h2", { text: "New calendar event" });
          const input = form.createEl("input", {
            type: "text",
            attr: { autocomplete: "off", autocorrect: "off" },
          });
          let resolved = false;
          let focusLoop: number | null = null;
          const finish = (value: string | undefined) => {
            if (resolved) return;
            resolved = true;
            if (focusLoop !== null) {
              window.clearInterval(focusLoop);
            }
            service.modalInput = null;
            resolve(value);
            this.close();
          };
          const maintain = () => {
            // Only refocus if input doesn't already have focus
            if (document.activeElement !== input) {
              service.applyFocus();
              input.focus({ preventScroll: true });
            }
          };
          this.scope.register([], "Enter", (evt) => {
            evt.preventDefault();
            finish(input.value.trim() || undefined);
          });
          this.scope.register([], "Escape", (evt) => {
            evt.preventDefault();
            finish(undefined);
          });
          ["keyup", "keydown", "keypress"].forEach((evtName) =>
            input.addEventListener(evtName, (evt) => evt.stopPropagation(), true),
          );
          setTimeout(maintain, 0);
          focusLoop = window.setInterval(maintain, 250);
          service.modalInput = input;
          form.addEventListener("submit", (evt) => {
            evt.preventDefault();
            finish(input.value.trim() || undefined);
          });
          const buttons = form.createDiv({ cls: "modal-button-container" });
          buttons.createEl("button", { text: "Create", type: "submit" });
          buttons
            .createEl("button", { text: "Cancel", type: "button" })
            .addEventListener("click", () => finish(undefined));
          this.onClose = () => {
            if (!resolved) {
              finish(undefined);
            }
            this.contentEl.empty();
          };
        }
      })(this.config.app);
      modal.open();
    });
  }

  private applyFocus() {
    if (!this.modalInput) return;
    try {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body?.classList?.remove("tps-context-hidden-for-keyboard");
    } catch {
      /* ignore */
    }
  }

  private buildFrontmatter(
    title: string,
    start: Date,
    end: Date,
    tags: string[] = [],
    overrides?: Record<string, any>,
  ): Record<string, any> {
    const result: Record<string, any> = {
      title,
    };

    // Add tags if present
    if (tags.length > 0) {
      result.tags = tags;
    }

    const startField = this.noteField(this.config.startProperty);
    const endField = this.noteField(this.config.endProperty);

    // Always write start date if we have a field
    if (startField) {
      result[startField] = formatDateTimeForFrontmatter(start);
    }

    // For end field, check if we should write duration or datetime
    if (endField) {
      if (this.config.useEndDuration) {
        // Write duration in minutes as a number
        const durationMs = end.getTime() - start.getTime();
        let durationMinutes = Math.round(durationMs / (60 * 1000));

        // If it's an all-day event (exactly 24h/1440m) and we have a default duration, use it
        // This prevents all-day clicks from defaulting to 1440m time estimates
        if (this.isAllDay(start, end) && durationMinutes === 1440 && this.config.defaultDuration) {
          durationMinutes = this.config.defaultDuration;
        }

        result[endField] = durationMinutes;
      } else {
        // Write end datetime as a string
        result[endField] = formatDateTimeForFrontmatter(end);
      }
    }

    const allDayField = this.noteField(this.config.allDayProperty) ?? "allDay";
    // Write as a boolean, not a string
    result[allDayField] = this.isAllDay(start, end);

    // Merge additional frontmatter (from filter templates)
    if (this.config.additionalFrontmatter) {
      Object.assign(result, this.config.additionalFrontmatter);
    }

    // Merge overrides (e.g. completed status)
    if (overrides) {
      // Handle tags specially to merge instead of overwrite
      if (overrides.tags) {
        const existingTags = (result.tags as string[]) || [];
        const newTags = Array.isArray(overrides.tags) ? overrides.tags : [overrides.tags];
        // Merge and deduplicate
        result.tags = [...new Set([...existingTags, ...newTags])];

        // Remove tags from overrides copy to avoid Object.assign overwriting it back
        const overridesCopy = { ...overrides };
        delete overridesCopy.tags;
        Object.assign(result, overridesCopy);
      } else {
        Object.assign(result, overrides);
      }
    }

    // Ensure title is not overwritten
    result.title = title;

    return result;
  }

  private noteField(propId?: BasesPropertyId | null): string | null {
    if (!propId) return null;
    const parsed = parsePropertyId(propId);

    if (parsed.type === "note") {
      const fieldName = parsed.name || (parsed as any).property;
      if (fieldName) {
        return fieldName;
      }
    }
    return null;
  }

  private isAllDay(start: Date, end: Date): boolean {
    return (
      start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      end.getHours() === 0 &&
      end.getMinutes() === 0
    );
  }

  private buildNoteContent(
    templateContent: string | null,
    fields: Record<string, any>,
  ): string {
    const tpl = templateContent ?? "";
    const trimmed = tpl.trimStart();
    if (trimmed.startsWith("---")) {
      const end = trimmed.indexOf("---", 3);
      if (end !== -1) {
        const fmRaw = trimmed.slice(3, end).trim();
        const body = trimmed.slice(end + 3).trimStart();
        const fmObj = fmRaw ? (parseYaml(fmRaw) as Record<string, unknown>) : {};
        Object.assign(fmObj, fields);
        return `---\n${stringifyYaml(fmObj)}---\n\n${body}`;
      }
    }
    return `---\n${stringifyYaml(fields)}---\n\n${tpl}`;
  }

  private async loadTemplate(path?: string | null): Promise<string | null> {
    if (!path) return null;
    try {
      const file = this.config.app.vault.getAbstractFileByPath(
        normalizePath(path),
      );
      if (file && file instanceof TFile) {
        return await this.config.app.vault.read(file);
      }
    } catch (error) {
      logger.warn("[Weekly Calendar] Failed to load template", error);
    }
    return null;
  }

  private buildUniquePath(folderPath: string, title: string, date: Date): string {
    // First, strip any existing date prefix from title (YYYY-MM-DD format)
    let cleanTitle = title.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim();

    // Sanitize title to be Obsidian-friendly
    const sanitizedTitle = cleanTitle
      .replace(/[\\/:*?"<>|]/g, '')     // Remove invalid filename chars
      .replace(/\s+/g, ' ')             // Normalize whitespace to single space
      .trim();

    // Build date suffix
    const dateSuffix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;

    // Check if title already includes the date suffix
    let finalTitle = sanitizedTitle;
    if (!sanitizedTitle.includes(dateSuffix)) {
      finalTitle = `${sanitizedTitle} ${dateSuffix}`;
    }

    // Construct path with date suffix
    let path = normalizePath(`${folderPath}/${finalTitle}.md`);

    // If file exists, add a counter
    let counter = 1;
    while (this.config.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folderPath}/${finalTitle} ${counter}.md`);
      counter++;
    }
    return path;
  }

  private async promptForPastEvent(): Promise<"complete" | "active" | "cancel"> {
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: "Event in Past" });
          contentEl.createEl("div", {
            text: "This event is in the past. Would you like to mark it as complete?",
            cls: "setting-item-description",
            attr: { style: "margin-bottom: 20px;" }
          });
          contentEl.createEl("div", {
            text: "(Select 'No, Active' for time blocks/logs that shouldn't be completed)",
            cls: "setting-item-description",
            attr: { style: "margin-bottom: 20px; font-style: italic; font-size: 0.9em;" }
          });

          const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
          buttonContainer.style.display = "flex";
          buttonContainer.style.justifyContent = "center";
          buttonContainer.style.gap = "10px";

          const completeBtn = buttonContainer.createEl("button", { text: "Yes, Complete", cls: "mod-cta" });
          completeBtn.addEventListener("click", () => {
            resolve("complete");
            this.close();
          });

          const activeBtn = buttonContainer.createEl("button", { text: "No, Active" });
          activeBtn.addEventListener("click", () => {
            resolve("active");
            this.close();
          });

          const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
          cancelBtn.addEventListener("click", () => {
            resolve("cancel");
            this.close();
          });

          this.onClose = () => {
            // Implicit cancel if not resolved
          };
        }

        onClose() {
          this.contentEl.empty();
          resolve("cancel");
        }
      })(this.config.app);
      modal.open();
    });
  }
}
