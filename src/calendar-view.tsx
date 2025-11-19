import {
  BasesEntry,
  BasesPropertyId,
  BasesView,
  DateValue,
  Menu,
  parsePropertyId,
  QueryController,
  ViewOption,
} from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import { CalendarReactView } from "./CalendarReactView";
import { AppContext } from "./context";
import { NewEventService } from "./new-event-service";
import { CalendarPluginBridge } from "./plugin-interface";
import {
  DEFAULT_CONDENSE_LEVEL,
  MAX_CONDENSE_LEVEL,
} from "./utils";

export const CalendarViewType = "calendar";

interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
  title?: string;
}

export class CalendarView extends BasesView {
  type = CalendarViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  root: Root | null = null;
  private plugin: CalendarPluginBridge;
  private configService: ConfigService;

  // Internal rendering data
  private entries: CalendarEntry[] = [];
  private startDateProp: BasesPropertyId | null = null;
  private endDateProp: BasesPropertyId | null = null;
  private titleProp: BasesPropertyId | null = null;
  private weekStartDay: number = 1;
  private refreshTimeout: number | null = null;
  private newEventFolder: string | null = null;
  private newEventTemplate: string | null = null;
  private allDayProperty: BasesPropertyId | null = null;
  private priorityField: BasesPropertyId | null = null;
  private statusField: BasesPropertyId | null = null;
  private condenseLevel: number = DEFAULT_CONDENSE_LEVEL;
  private showFullDay: boolean = false;
  private currentDate: Date = new Date();
  private dayCount: number = 7;
  private navStep: number = 7;
  private minHour: string = "";
  private maxHour: string = "";
  private condenseStorageKey: string;
  private newEventService: NewEventService;

  constructor(
    controller: QueryController,
    scrollEl: HTMLElement,
    plugin: CalendarPluginBridge,
  ) {
    super(controller);
    this.plugin = plugin;
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv({
      cls: "bases-calendar-container is-loading",
      attr: { tabIndex: 0 },
    });
    this.newEventService = new NewEventService({ app: this.app });
    this.condenseStorageKey = `bases-calendar-condense-${controller.query.id}`;
  }

  onload(): void {
    // React components will handle their own lifecycle
    this.registerEvent(
      this.app.workspace.on("tps-gcm-delete-complete", () => {
        this.newEventService.ensureFocus();
      }),
    );
    this.registerRefreshListeners();
  }

  onResize(): void {
    // TODO: Find a better way to handle resizing
    this.updateCalendar();
  }

  onunload(): void {
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.entries = [];
  }

  public focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  public onDataUpdated(): void {
    this.containerEl.removeClass("is-loading");
    this.loadConfig();
    this.updateCalendar();
  }

  private loadConfig(): void {
    // Date properties
    this.startDateProp = this.config.getAsPropertyId("startDate");
    this.endDateProp = this.config.getAsPropertyId("endDate");
    this.titleProp = this.config.getAsPropertyId("titleProperty");

    // Calendar options
    this.priorityField = this.config.getAsPropertyId("priorityField");
    this.statusField = this.config.getAsPropertyId("statusField");
    const weekStartDayValue = this.config.get("weekStartDay") as string;
    this.weekStartDay = weekStartDayValue
      ? this.getWeekStartDay(weekStartDayValue)
      : 1; // Default to Monday

    // Condense level with localStorage fallback
    const configCondenseLevel = this.config.get("condenseLevel") as number | undefined;
    if (configCondenseLevel !== undefined) {
      this.condenseLevel = this.normalizeCondenseLevel(configCondenseLevel);
    } else {
      this.condenseLevel = this.getCondenseLevelFromStorage();
    }

    // Time range
    const minHourValue = this.config.get("minHour") as string | undefined;
    const maxHourValue = this.config.get("maxHour") as string | undefined;
    this.minHour = this.normalizeHour(minHourValue || "");
    this.maxHour = this.normalizeHour(maxHourValue || "");

    // View options
    this.showFullDay = (this.config.get("showFullDay") as boolean) ?? false;
    this.dayCount = (this.config.get("dayCount") as number) ?? 7;
    this.navStep = (this.config.get("navStep") as number) ?? 7;

    // Event creation
    this.newEventFolder = (this.config.get("newEventFolder") as string) || null;
    this.newEventTemplate = (this.config.get("newEventTemplate") as string) || null;
    this.allDayProperty =
      this.config.getAsPropertyId("allDayProperty") ?? ("note.allDay" as BasesPropertyId);

    this.updateNewEventService();
  }

  private updateNewEventService(): void {
    this.newEventService.updateConfig({
      app: this.app,
      startProperty: this.startDateProp,
      endProperty: this.endDateProp,
      allDayProperty: this.allDayProperty,
      folderPath: this.newEventFolder,
      templatePath: this.newEventTemplate,
    });
  }

  private updateCalendar(): void {
    if (!this.data || !this.startDateProp) {
      this.root?.unmount();
      this.root = null;
      this.containerEl.empty();
      this.containerEl.createDiv("bases-calendar-empty").textContent =
        "Configure a start date property to display entries";
      return;
    }

    this.entries = [];
    for (const entry of this.data.data) {
      const startDate = this.extractDate(entry, this.startDateProp);
      if (startDate) {
        const endDate = this.endDateProp
          ? (this.extractDate(entry, this.endDateProp) ?? undefined)
          : undefined;
        const title = this.titleProp
          ? (entry.getValue(this.titleProp) as string | undefined)
          : undefined;
        this.entries.push({
          entry,
          startDate,
          endDate,
          title,
        });
      }
    }

    this.renderReactCalendar();
  }

  private async handleCreateRange(start: Date, end: Date): Promise<void> {
    await this.newEventService.createEvent(start, end);
    this.updateCalendar();
  }

  private renderReactCalendar(): void {
    if (!this.root) {
      this.root = createRoot(this.containerEl);
    }

    this.root.render(
      <StrictMode>
        <AppContext.Provider value={this.app}>
          <CalendarReactView
            entries={this.entries}
            weekStartDay={this.weekStartDay}
            properties={this.config.getOrder() || []}
            onEntryClick={(entry, isModEvent) => {
              void this.app.workspace.openLinkText(
                entry.file.path,
                "",
                isModEvent,
              );
            }}
            onEntryContextMenu={(evt, entry) => {
              evt.preventDefault();
              this.showEntryContextMenu(evt.nativeEvent as MouseEvent, entry);
            }}
            onEventDrop={(entry, newStart, newEnd, allDay) =>
              this.handleEventDrop(entry, newStart, newEnd, allDay)
            }
            onEventResize={(entry, newStart, newEnd, allDay) =>
              this.handleEventResize(entry, newStart, newEnd, allDay)
            }
            onCreateSelection={(start, end) => this.handleCreateRange(start, end)}
            editable={this.isEditable()}
            priorityField={this.priorityField}
            statusField={this.statusField}
            priorityColorMap={this.plugin.getPriorityColorMap()}
            statusStyleMap={this.plugin.getStatusStyleMap()}
            condenseLevel={this.condenseLevel}
            showFullDay={this.showFullDay}
            dayCount={this.dayCount}
            navStep={this.navStep}
            slotRange={this.getSlotRange()}
            initialDate={this.computeInitialDate()}
            currentDate={this.currentDate}
            onDateChange={(date) => {
              this.currentDate = date;
            }}
            onToggleFullDay={() => this.toggleFullDay()}
            allDayProperty={this.allDayProperty}
          />
        </AppContext.Provider>
      </StrictMode>,
    );
  }

  private isEditable(): boolean {
    if (!this.startDateProp) return false;
    const startDateProperty = parsePropertyId(this.startDateProp);
    if (startDateProperty.type !== "note") return false;

    if (!this.endDateProp) return true;
    const endDateProperty = parsePropertyId(this.endDateProp);
    if (endDateProperty.type !== "note") return false;

    return true;
  }

  private extractDate(entry: BasesEntry, propId: BasesPropertyId): Date | null {
    try {
      const value = entry.getValue(propId);
      if (!value) return null;
      if (!(value instanceof DateValue)) return null;
      // Private API
      if ("date" in value && value.date && value.date instanceof Date) {
        return value.date;
      }

      return null;
    } catch (error) {
      console.error(`Error extracting date for ${entry.file.name}:`, error);
      return null;
    }
  }

  private showEntryContextMenu(evt: MouseEvent, entry: BasesEntry): void {
    const file = entry.file;

    // Try to use tps-global-context-menu plugin if available
    const gcmPlugin = (this.app as any).plugins?.plugins?.["TPS-Global-Context-Menu"];
    if (gcmPlugin?.menuController) {
      try {
        gcmPlugin.menuController.showForFiles([file], evt);
        return;
      } catch (error) {
        console.error("Error showing TPS-Global-Context-Menu:", error);
      }
    }

    // Fall back to standard context menu
    const menu = Menu.forEvent(evt);

    this.app.workspace.handleLinkContextMenu(menu, file.path, "");

    menu.addItem((item) =>
      item
        .setSection("danger")
        .setTitle("Delete file")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => this.app.fileManager.promptForDeletion(file)),
    );
  }

  private async handleEventDrop(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
  ): Promise<void> {
    // Normalize dates for all-day events
    let normalizedStart = newStart;
    let normalizedEnd = newEnd;

    if (allDay) {
      normalizedStart = new Date(newStart);
      normalizedStart.setHours(0, 0, 0, 0);
      if (newEnd) {
        normalizedEnd = new Date(newEnd);
        normalizedEnd.setHours(0, 0, 0, 0);
      }
    }

    await this.updateEntryDates(entry, normalizedStart, normalizedEnd, allDay);
  }

  private async handleEventResize(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
  ): Promise<void> {
    if (!newEnd) {
      console.warn("Event resize requires an end date");
      return;
    }
    await this.updateEntryDates(entry, newStart, newEnd, allDay);
  }

  private async updateEntryDates(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
  ): Promise<void> {
    if (!this.startDateProp) return;

    const file = entry.file;
    const startField = this.getNoteField(this.startDateProp);
    const endField = this.getNoteField(this.endDateProp);
    const allDayField = this.getNoteField(this.allDayProperty);

    if (!startField) {
      console.warn("Start date property is not a note property");
      return;
    }

    if (this.endDateProp && !endField) {
      console.warn("End date property is not a note property");
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const formatDateTimeForFrontmatter = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day} ${hours}:${minutes}`;
      };

      frontmatter[startField] = formatDateTimeForFrontmatter(newStart);

      if (this.endDateProp && newEnd && endField) {
        frontmatter[endField] = formatDateTimeForFrontmatter(newEnd);

        // Calculate and store duration in minutes
        const durationMinutes = Math.round((newEnd.getTime() - newStart.getTime()) / (1000 * 60));
        if (durationMinutes > 0) {
          frontmatter["duration"] = durationMinutes;
        }
      }

      // Update allDay property if configured
      if (allDayField && allDay !== undefined) {
        frontmatter[allDayField] = allDay;
      }
    });
  }

  public setEphemeralState(state: unknown): void {
    // State management could be extended for React component
  }

  public getEphemeralState(): unknown {
    return {};
  }

  // Helper methods
  private getWeekStartDay(dayName: string): number {
    const dayNameToNumber: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return dayNameToNumber[dayName] ?? 1;
  }

  private normalizeCondenseLevel(value: number): number {
    return Math.max(0, Math.min(MAX_CONDENSE_LEVEL, value));
  }

  private normalizeHour(value: string): string {
    if (!value) return "";
    // Validate HH:MM or HH:MM:SS format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (!timeRegex.test(value)) {
      return "";
    }
    return value;
  }

  private getNoteField(propId: BasesPropertyId | null): string | null {
    if (!propId) return null;
    const parsed = parsePropertyId(propId);
    return parsed.type === "note" ? parsed.name : null;
  }

  private getCondenseLevelFromStorage(): number {
    const stored = window.localStorage.getItem(this.condenseStorageKey);
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) {
        return this.normalizeCondenseLevel(parsed);
      }
    }
    return DEFAULT_CONDENSE_LEVEL;
  }

  private setCondenseLevelInStorage(level: number): void {
    window.localStorage.setItem(this.condenseStorageKey, level.toString());
  }

  private getSlotRange(): { min: string; max: string } {
    return {
      min: this.minHour || "00:00",
      max: this.maxHour || "24:00",
    };
  }

  private computeInitialDate(): Date {
    return new Date();
  }

  private getInitialDate(): Date {
    return this.currentDate;
  }

  private updateCondenseLevel(level: number): void {
    const normalized = this.normalizeCondenseLevel(level);
    this.condenseLevel = normalized;
    this.setCondenseLevelInStorage(normalized);
    this.config.set("condenseLevel", normalized);
    this.renderReactCalendar();
  }

  private toggleFullDay(): void {
    this.showFullDay = !this.showFullDay;
    this.config.set("showFullDay", this.showFullDay);
    this.renderReactCalendar();
  }

  private hasEntryForFile(path: string): boolean {
    return this.entries.some((e) => e.entry.file.path === path);
  }

  private handleTrackedFileChange = (file: { path: string }): void => {
    if (this.hasEntryForFile(file.path)) {
      this.scheduleRefresh();
    }
  };

  private scheduleRefresh(): void {
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = window.setTimeout(() => {
      const scrollPos = this.scrollEl.scrollTop;

      this.entries = [];
      for (const entry of this.data.data) {
        const startDate = this.extractDate(entry, this.startDateProp);
        if (startDate) {
          const endDate = this.endDateProp
            ? (this.extractDate(entry, this.endDateProp) ?? undefined)
            : undefined;
          const title = this.titleProp
            ? (entry.getValue(this.titleProp) as string | undefined)
            : undefined;
          this.entries.push({
            entry,
            startDate,
            endDate,
            title,
          });
        }
      }

      this.renderReactCalendar();
      this.scrollEl.scrollTop = scrollPos;
      this.refreshTimeout = null;
    }, 120);
  }

  private registerRefreshListeners(): void {
    this.registerEvent(
      this.app.vault.on("modify", this.handleTrackedFileChange),
    );
    this.registerEvent(
      this.app.vault.on("rename", this.handleTrackedFileChange),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", this.handleTrackedFileChange),
    );
  }

  public refreshFromPluginSettings(): void {
    this.renderReactCalendar();
  }

  static getViewOptions(): ViewOption[] {
    return [
      {
        displayName: "Date properties",
        type: "group",
        items: [
          {
            displayName: "Start date",
            type: "property",
            key: "startDate",
            placeholder: "Property",
          },
          {
            displayName: "End date (optional)",
            type: "property",
            key: "endDate",
            placeholder: "Property",
          },
          {
            displayName: "Title property (optional)",
            type: "property",
            key: "titleProperty",
            placeholder: "Property",
          },
        ],
      },
      {
        displayName: "Calendar options",
        type: "group",
        items: [
          {
            displayName: "Week starts on",
            type: "dropdown",
            key: "weekStartDay",
            default: "monday",
            options: {
              sunday: "Sunday",
              monday: "Monday",
              tuesday: "Tuesday",
              wednesday: "Wednesday",
              thursday: "Thursday",
              friday: "Friday",
              saturday: "Saturday",
            },
          },
          {
            displayName: "Condense level (0-220)",
            type: "number",
            key: "condenseLevel",
            default: DEFAULT_CONDENSE_LEVEL,
          },
          {
            displayName: "Show full-day slot",
            type: "checkbox",
            key: "showFullDay",
            default: false,
          },
          {
            displayName: "Priority property",
            type: "property",
            key: "priorityField",
            placeholder: "note.priority",
          },
          {
            displayName: "Status property",
            type: "property",
            key: "statusField",
            placeholder: "note.status",
          },
        ],
      },
      {
        displayName: "Time range",
        type: "group",
        items: [
          {
            displayName: "Earliest hour",
            type: "text",
            key: "minHour",
            default: "",
            placeholder: "06:00",
          },
          {
            displayName: "Latest hour",
            type: "text",
            key: "maxHour",
            default: "",
            placeholder: "20:00",
          },
        ],
      },
      {
        displayName: "View options",
        type: "group",
        items: [
          {
            displayName: "Day count",
            type: "dropdown",
            key: "dayCount",
            default: 7,
            options: {
              3: "3 days",
              5: "5 days",
              7: "1 week",
              30: "1 month",
            },
          },
          {
            displayName: "Navigation step",
            type: "dropdown",
            key: "navStep",
            default: 7,
            options: {
              1: "1 day",
              7: "1 week",
              30: "1 month",
            },
          },
        ],
      },
      {
        displayName: "Event creation",
        type: "group",
        items: [
          {
            displayName: "New event folder",
            type: "text",
            key: "newEventFolder",
            default: "",
            placeholder: "01 Action Items/Events",
          },
          {
            displayName: "New event template",
            type: "text",
            key: "newEventTemplate",
            default: "System/Templates/Root template.md",
            placeholder: "System/Templates/Root template.md",
          },
          {
            displayName: "All-day property",
            type: "property",
            key: "allDayProperty",
            placeholder: "note.allDay",
          },
        ],
      },
    ];
  }
}
