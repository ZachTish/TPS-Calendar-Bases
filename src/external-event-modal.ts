import {
  App,
  Modal,
  TFile,
  normalizePath,
} from "obsidian";
import { ExternalCalendarEvent } from "./external-calendar-service";
import * as logger from "./logger";
import { formatDateTimeForFrontmatter } from "./utils";

export class ExternalEventModal extends Modal {
  private event: ExternalCalendarEvent;
  private onCreateNote: (event: ExternalCalendarEvent) => Promise<void>;
  private onHide?: (event: ExternalCalendarEvent) => Promise<void>;

  constructor(
    app: App,
    event: ExternalCalendarEvent,
    onCreateNote: (event: ExternalCalendarEvent) => Promise<void>,
    onHide?: (event: ExternalCalendarEvent) => Promise<void>
  ) {
    super(app);
    this.event = event;
    this.onCreateNote = onCreateNote;
    this.onHide = onHide;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("external-event-modal");

    // Title
    contentEl.createEl("h2", { text: this.event.title });

    // Details container
    const detailsEl = contentEl.createDiv({ cls: "external-event-details" });

    // Time
    const timeEl = detailsEl.createDiv({ cls: "external-event-field" });
    timeEl.createEl("strong", { text: "When: " });
    timeEl.createSpan({
      text: this.formatEventTime(this.event.startDate, this.event.endDate, this.event.isAllDay),
    });

    // Location
    if (this.event.location) {
      const locationEl = detailsEl.createDiv({ cls: "external-event-field" });
      locationEl.createEl("strong", { text: "Location: " });
      locationEl.createSpan({ text: this.event.location });
    }

    // Organizer
    if (this.event.organizer) {
      const organizerEl = detailsEl.createDiv({ cls: "external-event-field" });
      organizerEl.createEl("strong", { text: "Organizer: " });
      organizerEl.createSpan({ text: this.event.organizer });
    }

    // Attendees
    if (this.event.attendees && this.event.attendees.length > 0) {
      const attendeesEl = detailsEl.createDiv({ cls: "external-event-field" });
      attendeesEl.createEl("strong", { text: "Attendees: " });
      attendeesEl.createSpan({ text: this.event.attendees.join(", ") });
    }

    // Description
    if (this.event.description) {
      const descEl = detailsEl.createDiv({ cls: "external-event-field" });
      descEl.createEl("strong", { text: "Description: " });
      const descText = detailsEl.createDiv({ cls: "external-event-description" });
      descText.setText(this.event.description);
    }

    // URL
    if (this.event.url) {
      const urlEl = detailsEl.createDiv({ cls: "external-event-field" });
      urlEl.createEl("strong", { text: "Link: " });
      const link = urlEl.createEl("a", {
        text: this.event.url,
        href: this.event.url,
      });
      link.setAttr("target", "_blank");
    }

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    buttonContainer.style.marginTop = "20px";
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.justifyContent = "flex-end";

    if (this.onHide) {
      const hideBtn = buttonContainer.createEl("button", {
        text: "Hide Event",
      });
      hideBtn.addEventListener("click", async () => {
        if (this.onHide) {
          await this.onHide(this.event);
          this.close();
        }
      });
    }

    const createNoteBtn = buttonContainer.createEl("button", {
      text: "Create Meeting Note",
      cls: "mod-cta",
    });
    createNoteBtn.addEventListener("click", async () => {
      await this.onCreateNote(this.event);
      this.close();
    });

    const closeBtn = buttonContainer.createEl("button", {
      text: "Close",
    });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private formatEventTime(start: Date, end: Date, isAllDay: boolean): string {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    };

    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };

    if (isAllDay) {
      return new Intl.DateTimeFormat(undefined, dateOptions).format(start);
    }

    const dateStr = new Intl.DateTimeFormat(undefined, dateOptions).format(start);
    const startTime = new Intl.DateTimeFormat(undefined, timeOptions).format(start);
    const endTime = new Intl.DateTimeFormat(undefined, timeOptions).format(end);

    return `${dateStr}, ${startTime} - ${endTime}`;
  }
}

export async function createMeetingNoteFromExternalEvent(
  app: App,
  event: ExternalCalendarEvent,
  templatePath: string | null,
  folderPath: string | null,
  startProperty: string | null,
  endProperty: string | null,
  useEndDuration: boolean,
  calendarTag: string | null = null
): Promise<TFile | null> {
  // Load template
  let templateContent = "";
  if (templatePath) {
    const file = app.vault.getAbstractFileByPath(normalizePath(templatePath));
    if (file && file instanceof TFile) {
      templateContent = await app.vault.read(file);
    }
  }

  // Build frontmatter object for fields we need to set
  const frontmatter: Record<string, any> = {
    title: event.title,
    googleEventId: event.id,
  };

  if (startProperty) {
    frontmatter[startProperty] = formatDateTimeForFrontmatter(event.startDate);
  }

  if (endProperty) {
    if (useEndDuration) {
      const durationMinutes = Math.round(
        (event.endDate.getTime() - event.startDate.getTime()) / (60 * 1000)
      );
      // Always use minutes (e.g. 90)
      frontmatter[endProperty] = durationMinutes;
    } else {
      frontmatter[endProperty] = formatDateTimeForFrontmatter(event.endDate);
    }
  }

  // Build note content (body only, frontmatter handled separately)
  let noteContent = templateContent;

  // Replace template placeholders if template exists
  if (templateContent) {
    noteContent = templateContent
      .replace(/{{title}}/g, event.title)
      .replace(/{{description}}/g, event.description || "")
      .replace(/{{location}}/g, event.location || "")
      .replace(/{{organizer}}/g, event.organizer || "")
      .replace(/{{attendees}}/g, event.attendees?.join(", ") || "")
      .replace(/{{url}}/g, event.url || "");
  } else {
    // Default content if no template
    noteContent = `# ${event.title}\n\n`;
    if (event.description) {
      noteContent += `## Description\n${event.description}\n\n`;
    }
    if (event.attendees && event.attendees.length > 0) {
      noteContent += `## Attendees\n${event.attendees.map(a => `- ${a}`).join("\n")}\n\n`;
    }
    noteContent += `## Notes\n\n`;
  }

  // Determine file path
  const folder = folderPath ? normalizePath(folderPath) : "";

  // Ensure folder exists
  if (folder) {
    const folderFile = app.vault.getAbstractFileByPath(folder);
    if (!folderFile) {
      try {
        await app.vault.createFolder(folder);
      } catch (e) {
        logger.error(`Failed to create folder ${folder}:`, e);
        // Fallback to root if folder creation fails
      }
    }
  }

  const sanitizedTitle = event.title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const dateSuffix = `${event.startDate.getFullYear()}-${String(
    event.startDate.getMonth() + 1
  ).padStart(2, "0")}-${String(event.startDate.getDate()).padStart(2, "0")}`;

  let path = normalizePath(`${folder}/${sanitizedTitle} ${dateSuffix}.md`);
  let counter = 1;
  while (app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(`${folder}/${sanitizedTitle} ${dateSuffix} ${counter}.md`);
    counter++;
  }

  // Create the file with template content first (preserves original formatting)
  const file = await app.vault.create(path, noteContent);

  // Use processFrontMatter to add fields while preserving template formatting
  await app.fileManager.processFrontMatter(file, (fm) => {
    // Handle tags merging if calendarTag is specified
    if (calendarTag) {
      let existingTags: string[] = [];
      if (Array.isArray(fm.tags)) {
        existingTags = fm.tags.map(String);
      } else if (typeof fm.tags === 'string') {
        existingTags = [fm.tags];
      }

      if (!existingTags.includes(calendarTag)) {
        existingTags.push(calendarTag);
      }
      fm.tags = existingTags;
    }

    // Delete template's title first to ensure ours takes precedence
    delete fm.title;
    // Merge in our frontmatter fields
    Object.assign(fm, frontmatter);
  });

  return file;
}
