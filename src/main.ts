import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { CalendarView, CalendarViewType } from "./calendar-view";
import {
  DEFAULT_CONDENSE_LEVEL,
  DEFAULT_PRIORITY_COLOR_MAP,
  DEFAULT_STATUS_STYLE_MAP,
} from "./utils";
import { CalendarPluginBridge } from "./plugin-interface";
import { AutoCreateService } from "./services/auto-create-service";

const PRIORITY_KEYS = ["low", "normal", "medium", "high"];
const STATUS_KEYS = ["open", "complete", "wont-do", "working", "blocked"];
const TEXT_STYLE_PRESETS: Array<{ value: string; label: string }> = [
  { value: "bold", label: "Bold" },
  { value: "italic", label: "Italic" },
  { value: "strikethrough", label: "Strikethrough" },
  { value: "line-through", label: "Line-through" },
];

type CalendarStyleMatch = "all" | "any";
type CalendarField = "status" | "priority";
type CalendarOperator =
  | "is"
  | "!is"
  | "contains"
  | "!contains"
  | "starts"
  | "!starts"
  | "ends"
  | "!ends"
  | "exists"
  | "!exists";

const CONDITION_FIELDS: Array<{ value: CalendarField; label: string }> = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
];

const CALENDAR_OPERATORS: CalendarOperator[] = [
  "is",
  "!is",
  "contains",
  "!contains",
  "starts",
  "!starts",
  "ends",
  "!ends",
  "exists",
  "!exists",
];

interface CalendarStyleCondition {
  field: CalendarField;
  operator: CalendarOperator;
  value: string;
}

interface CalendarStyleRule {
  id: string;
  label: string;
  active?: boolean;
  match?: CalendarStyleMatch;
  conditions: CalendarStyleCondition[];
  color?: string;
  textStyle?: string;
}

interface ExternalCalendarConfig {
  id: string;
  url: string;
  color?: string;
  tag?: string;
  enabled?: boolean;
}

const OPERATOR_LABELS: Record<CalendarOperator, string> = {
  is: "is",
  "!is": "is not",
  contains: "contains",
  "!contains": "does not contain",
  starts: "starts with",
  "!starts": "does not start with",
  ends: "ends with",
  "!ends": "does not end with",
  exists: "exists",
  "!exists": "missing",
};

const MATCH_OPTIONS: Array<{ value: CalendarStyleMatch; label: string }> = [
  { value: "all", label: "Match all of the following" },
  { value: "any", label: "Match any of the following" },
];

const DEFAULT_MATCH: CalendarStyleMatch = "all";

const createRuleId = () =>
  `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

const createCalendarId = () =>
  `calendar-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

const createDefaultCondition = (): CalendarStyleCondition => ({
  field: "status",
  operator: "is",
  value: "",
});

const parseTextStyleTokens = (value?: string): string[] =>
  (value || "")
    .split(/[,|]/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

const buildTextStyleValue = (tokens: string[]): string =>
  tokens.filter(Boolean).join(", ");

const cloneRule = (rule: CalendarStyleRule): CalendarStyleRule => ({
  ...rule,
  conditions: rule.conditions.map((condition) => ({ ...condition })),
});

const normalizeStoredRule = (rule: any): CalendarStyleRule => ({
  id:
    typeof rule?.id === "string"
      ? rule.id
      : `rule-${Math.random().toString(36).slice(2, 8)}`,
  label: rule?.label || "",
  active: rule?.active !== false,
  match: rule?.match || DEFAULT_MATCH,
  conditions:
    rule?.conditions && Array.isArray(rule.conditions) && rule.conditions.length
      ? rule.conditions.map((condition: any) => ({
          field:
            condition?.field === "priority" ? "priority" : ("status" as CalendarField),
          operator:
            condition?.operator && CALENDAR_OPERATORS.includes(condition.operator)
              ? condition.operator
              : "is",
          value: condition?.value ? String(condition.value) : "",
        }))
      : [createDefaultCondition()],
  color: rule?.color || "",
  textStyle: rule?.textStyle || "",
});

const normalizeExternalCalendar = (
  calendar: any,
  fallback: { color?: string; tag?: string } = {},
): ExternalCalendarConfig => {
  const url = typeof calendar?.url === "string" ? calendar.url.trim() : "";
  return {
    id:
      typeof calendar?.id === "string"
        ? calendar.id
        : `calendar-${Math.random().toString(36).slice(2, 8)}`,
    url,
    color:
      typeof calendar?.color === "string"
        ? calendar.color.trim()
        : fallback.color ?? "",
    tag:
      typeof calendar?.tag === "string" ? calendar.tag.trim() : fallback.tag ?? "",
    enabled: calendar?.enabled !== false,
  };
};

const parseExternalCalendarUrls = (raw: string): string[] =>
  raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const buildExternalCalendarsFromLegacy = (stored: any = {}): ExternalCalendarConfig[] => {
  const urls = parseExternalCalendarUrls(stored?.externalCalendarUrls ?? "");
  const colors = stored?.calendarColors ?? {};
  const tags = stored?.calendarTags ?? {};
  return urls.map((url) =>
    normalizeExternalCalendar(
      {
        url,
        color: colors[url],
        tag: tags[url],
        enabled: true,
      },
      { color: colors[url], tag: tags[url] },
    ),
  );
};

const syncLegacyCalendarFields = (settings: CalendarPluginSettings) => {
  const calendars = settings.externalCalendars ?? [];
  const urls = calendars.map((calendar) => calendar.url).filter(Boolean);
  settings.externalCalendarUrls = urls.join("\n");
  settings.calendarColors = Object.fromEntries(
    calendars
      .filter((calendar) => calendar.url)
      .map((calendar) => [calendar.url, calendar.color || ""]),
  );
  settings.calendarTags = Object.fromEntries(
    calendars
      .filter((calendar) => calendar.url)
      .map((calendar) => [calendar.url, calendar.tag || ""]),
  );
};

const buildLegacyColorRules = (stored: any = {}): CalendarStyleRule[] => {
  const storedPriorityColors = stored?.priorityColors ?? stored?.priorityColorMap ?? {};
  const priorityColorMap: Record<string, string> = {
    ...DEFAULT_PRIORITY_COLOR_MAP,
    ...Object.fromEntries(
      Object.entries(storedPriorityColors).map(([key, value]) => [
        key.toLowerCase(),
        String(value || "").trim(),
      ]),
    ),
  };

  return PRIORITY_KEYS.map((priority) => ({
    id: `priority-${priority}`,
    label: `Priority: ${priority}`,
    active: true,
    match: DEFAULT_MATCH,
    conditions: [
      {
        field: "priority" as CalendarField,
        operator: "is" as CalendarOperator,
        value: priority,
      },
    ],
    color: priorityColorMap[priority] ?? DEFAULT_PRIORITY_COLOR_MAP[priority] ?? "",
  }));
};

const buildLegacyTextRules = (stored: any = {}): CalendarStyleRule[] => {
  const storedStatusStyles = stored?.statusStyles ?? stored?.statusStyleMap ?? {};
  const statusStyleMap: Record<string, string> = {
    ...DEFAULT_STATUS_STYLE_MAP,
    ...Object.fromEntries(
      Object.entries(storedStatusStyles).map(([key, value]) => [
        key.toLowerCase(),
        String(value || "").trim() || "normal",
      ]),
    ),
  };

  const statusSet = Array.from(
    new Set([...STATUS_KEYS, ...Object.keys(statusStyleMap)]),
  );

  return statusSet.map((status) => ({
    id: `status-${status}`,
    label: `Status: ${status}`,
    active: true,
    match: DEFAULT_MATCH,
    conditions: [
      {
        field: "status" as CalendarField,
        operator: "is" as CalendarOperator,
        value: status,
      },
    ],
    textStyle: statusStyleMap[status] ?? "normal",
  }));
};

const getOperatorOptions = (field: CalendarField) => {
  return CALENDAR_OPERATORS;
};

const getConditionPlaceholder = (field: CalendarField): string => {
  if (field === "priority") return "normal";
  return "complete";
};

const shouldDisableValueInput = (operator: CalendarOperator) =>
  operator === "exists" || operator === "!exists";

const evaluateCondition = (
  value: string | undefined,
  condition: CalendarStyleCondition,
): boolean => {
  const normalizedValue = (value || "").toLowerCase();
  const normalizedTarget = (condition.value || "").toLowerCase();
  switch (condition.operator) {
    case "is":
      return normalizedValue === normalizedTarget;
    case "!is":
      return normalizedValue !== normalizedTarget;
    case "contains":
      return normalizedValue.includes(normalizedTarget);
    case "!contains":
      return !normalizedValue.includes(normalizedTarget);
    case "starts":
      return normalizedValue.startsWith(normalizedTarget);
    case "!starts":
      return !normalizedValue.startsWith(normalizedTarget);
    case "ends":
      return normalizedValue.endsWith(normalizedTarget);
    case "!ends":
      return !normalizedValue.endsWith(normalizedTarget);
    case "exists":
      return normalizedValue.length > 0;
    case "!exists":
      return normalizedValue.length === 0;
    default:
      return false;
  }
};

const ruleHasMeaning = (rule: CalendarStyleRule): boolean => {
  const hasCondition = rule.conditions.some((condition) => {
    if (["exists", "!exists"].includes(condition.operator)) return true;
    return Boolean(condition.value?.trim());
  });
  const hasStyle = Boolean(rule.color?.trim()) || Boolean(rule.textStyle?.trim());
  return hasCondition || hasStyle;
};

interface CalendarPluginSettings {
  sidebarBasePath: string;
  colorRules: CalendarStyleRule[];
  textRules: CalendarStyleRule[];
  calendarStyleRules: CalendarStyleRule[];
  priorityValues: string[];
  statusValues: string[];
  defaultCondenseLevel: number;
  externalCalendars: ExternalCalendarConfig[];
  externalCalendarUrls: string;
  externalCalendarFilter: string;
  calendarColors: Record<string, string>;
  calendarTags: Record<string, string>;
  hiddenEvents: string[];
  enableLogging: boolean;
  autoCreateMeetingNotes: boolean;
  meetingNoteFolder: string;
  meetingNoteTemplate: string;
  syncIntervalMinutes: number;
  syncOnEventDelete: string;
  archiveFolder: string;
}


export default class ObsidianCalendarPlugin
  extends Plugin
  implements CalendarPluginBridge
{
settings: CalendarPluginSettings = {
    sidebarBasePath: "",
    colorRules: buildLegacyColorRules(),
    textRules: buildLegacyTextRules(),
    calendarStyleRules: [],
    priorityValues: PRIORITY_KEYS,
    statusValues: STATUS_KEYS,
    defaultCondenseLevel: DEFAULT_CONDENSE_LEVEL,
    externalCalendars: [],
    externalCalendarUrls: "",
    externalCalendarFilter: "",
    calendarColors: {},
    calendarTags: {},
    hiddenEvents: [],
    enableLogging: false,
    autoCreateMeetingNotes: false,
    meetingNoteFolder: "",
    meetingNoteTemplate: "",
    syncIntervalMinutes: 5,
    syncOnEventDelete: "archive",
    archiveFolder: "",
  };

  autoCreateService: AutoCreateService;

  async onload() {
    await this.loadSettings();
    this.autoCreateService = new AutoCreateService(this.app);
    this.registerBasesView(CalendarViewType, {
      name: "Calendar",
      icon: "lucide-calendar",
      factory: (controller, containerEl) =>
        new CalendarView(controller, containerEl, this),
      options: CalendarView.getOptions,
    });
    this.addSettingTab(new CalendarPluginSettingsTab(this.app, this));

    this.addCommand({
      id: "open-default-calendar-base-sidebar",
      name: "Open default calendar base in right sidebar",
      callback: () => this.openDefaultBaseInSidebar(),
    });

    this.addRibbonIcon("calendar", "Open default calendar base", async () => {
      await this.openDefaultBaseInSidebar();
    });
  }

  onunload() {}

  async loadSettings() {
    const stored = await this.loadData();
    const storedRules: CalendarStyleRule[] = Array.isArray(
      stored?.calendarStyleRules,
    )
      ? stored?.calendarStyleRules.map((rule: any) => normalizeStoredRule(rule))
      : [];
    const hasStoredRules = storedRules.some((rule) => ruleHasMeaning(rule));
    const calendarStyleRules = hasStoredRules
      ? storedRules
      : [...buildLegacyColorRules(stored), ...buildLegacyTextRules(stored)];
    const legacyColors = stored?.calendarColors ?? {};
    const legacyTags = stored?.calendarTags ?? {};
    const storedCalendars: ExternalCalendarConfig[] = Array.isArray(
      stored?.externalCalendars,
    )
      ? stored.externalCalendars.map((calendar: any) => {
          const normalized = normalizeExternalCalendar(calendar, {
            color: legacyColors[calendar?.url ?? ""],
            tag: legacyTags[calendar?.url ?? ""],
          });
          if (!normalized.color && legacyColors[normalized.url]) {
            normalized.color = legacyColors[normalized.url];
          }
          if (!normalized.tag && legacyTags[normalized.url]) {
            normalized.tag = legacyTags[normalized.url];
          }
          return normalized;
        })
      : [];
    const externalCalendars = storedCalendars.length
      ? storedCalendars
      : buildExternalCalendarsFromLegacy(stored);

this.settings = {
      sidebarBasePath: stored?.sidebarBasePath ?? "",
      colorRules: buildLegacyColorRules(stored),
      textRules: buildLegacyTextRules(stored),
      calendarStyleRules,
      priorityValues: stored?.priorityValues ?? PRIORITY_KEYS,
      statusValues: stored?.statusValues ?? STATUS_KEYS,
      defaultCondenseLevel:
        stored?.defaultCondenseLevel ?? DEFAULT_CONDENSE_LEVEL,
      externalCalendars,
      externalCalendarUrls: stored?.externalCalendarUrls ?? "",
      externalCalendarFilter: stored?.externalCalendarFilter ?? "",
      calendarColors: stored?.calendarColors ?? {},
      calendarTags: stored?.calendarTags ?? {},
      hiddenEvents: stored?.hiddenEvents ?? [],
      enableLogging: stored?.enableLogging ?? false,
      autoCreateMeetingNotes: stored?.autoCreateMeetingNotes ?? false,
      meetingNoteFolder: stored?.meetingNoteFolder ?? "",
      meetingNoteTemplate: stored?.meetingNoteTemplate ?? "",
      syncIntervalMinutes: stored?.syncIntervalMinutes ?? 5,
      syncOnEventDelete: stored?.syncOnEventDelete ?? "archive",
      archiveFolder: stored?.archiveFolder ?? "",
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshCalendarViews();
  }

  getCalendarStyleOverride(status?: string, priority?: string) {
    const normalizedStatus = status?.toLowerCase();
    const normalizedPriority = priority?.toLowerCase();
    const rules = this.settings.calendarStyleRules || [];
    for (const rule of rules) {
      if (rule.active === false) continue;
      const conditions = rule.conditions || [];
      if (!conditions.length) continue;
      const conditionResults = conditions.map((condition) => {
        const value =
          condition.field === "status" ? normalizedStatus : normalizedPriority;
        return evaluateCondition(value, condition);
      });

      const matchMode = rule.match || DEFAULT_MATCH;
      const ruleMatches =
        matchMode === "any"
          ? conditionResults.some((result) => result)
          : conditionResults.every((result) => result);

      if (ruleMatches) {
        return { color: rule.color, textStyle: rule.textStyle };
      }
    }
    return null;
  }

  getDefaultCondenseLevel(): number {
    return this.settings.defaultCondenseLevel ?? DEFAULT_CONDENSE_LEVEL;
  }

  getExternalCalendarUrls(): string[] {
    const calendars = this.settings.externalCalendars ?? [];
    const enabledCalendars = calendars.filter(
      (calendar) => calendar.url && calendar.enabled !== false,
    );
    if (enabledCalendars.length) {
      return enabledCalendars.map((calendar) => calendar.url);
    }
    const raw = this.settings.externalCalendarUrls ?? "";
    return parseExternalCalendarUrls(raw);
  }

  getExternalCalendarFilter(): string {
    return this.settings.externalCalendarFilter ?? "";
  }

  getCalendarColor(url: string): string {
    const calendars = this.settings.externalCalendars ?? [];
    const match = calendars.find((calendar) => calendar.url === url);
    return match?.color || this.settings.calendarColors?.[url] || "#3b82f6";
  }

  getCalendarTag(url: string): string {
    const calendars = this.settings.externalCalendars ?? [];
    const match = calendars.find((calendar) => calendar.url === url);
    return match?.tag || this.settings.calendarTags?.[url] || "";
  }

  getHiddenEvents(): string[] {
    return this.settings.hiddenEvents ?? [];
  }

  async addHiddenEvent(eventId: string): Promise<void> {
    if (!eventId) return;
    if (!this.settings.hiddenEvents) {
      this.settings.hiddenEvents = [];
    }
    if (!this.settings.hiddenEvents.includes(eventId)) {
      this.settings.hiddenEvents.push(eventId);
      await this.saveSettings();
    }
  }

  async removeHiddenEvent(eventId: string): Promise<void> {
    if (!eventId || !this.settings.hiddenEvents) return;
    const filtered = this.settings.hiddenEvents.filter((id) => id !== eventId);
    if (filtered.length === this.settings.hiddenEvents.length) return;
    this.settings.hiddenEvents = filtered;
    await this.saveSettings();
  }

  getPriorityValues(): string[] {
    return this.settings.priorityValues ?? [];
  }

  getStatusValues(): string[] {
    return this.settings.statusValues ?? [];
  }

  refreshCalendarViews() {
    const leaves = this.app.workspace.getLeavesOfType(CalendarViewType);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as CalendarView | null;
      view?.refreshFromPluginSettings();
    }
  }

  async openDefaultBaseInSidebar(): Promise<void> {
    const path = this.settings.sidebarBasePath?.trim();
    if (!path) {
      new Notice("Set a default calendar base path in settings first.");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      new Notice(`File not found: ${path}`);
      return;
    }
    if (!(file as any).extension) {
      new Notice("Default calendar base must be a file.");
      return;
    }
    let leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(true);
    }
    if (!leaf) {
      new Notice("Could not open right sidebar.");
      return;
    }
    await (leaf as any).openFile(file, { active: false });
    this.app.workspace.revealLeaf(leaf);
  }
}

class CalendarPluginSettingsTab extends PluginSettingTab {
  plugin: ObsidianCalendarPlugin;

  constructor(app: Plugin["app"], plugin: ObsidianCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Calendar styling" });

    containerEl.createEl("h3", { text: "Calendar style rules" });
    const styleRuleContainer = containerEl.createDiv();
    this.renderCalendarStyleRules(styleRuleContainer);
    new Setting(containerEl)
      .setName("Add rule")
      .setDesc("Rules are evaluated top to bottom; first match wins.")
      .addButton((btn) =>
        btn
          .setIcon("plus")
          .setButtonText("Add rule")
          .onClick(async () => {
            const rules = this.plugin.settings.calendarStyleRules;
            rules.push({
              id: createRuleId(),
              label: `Rule ${rules.length + 1}`,
              active: true,
              match: DEFAULT_MATCH,
              conditions: [createDefaultCondition()],
              color: "",
              textStyle: "",
            });
            await this.plugin.saveSettings();
            this.renderCalendarStyleRules(styleRuleContainer);
          }),
      );

    containerEl.createEl("h3", { text: "External calendars" });
    const calendarsContainer = containerEl.createDiv();
    this.renderExternalCalendars(calendarsContainer);

    new Setting(containerEl)
      .setName("Add calendar")
      .setDesc("Add an external iCal feed and assign its color + auto-create tag.")
      .addButton((btn) =>
        btn
          .setIcon("plus")
          .setButtonText("Add calendar")
          .onClick(async () => {
            if (!this.plugin.settings.externalCalendars) {
              this.plugin.settings.externalCalendars = [];
            }
            this.plugin.settings.externalCalendars.push({
              id: createCalendarId(),
              url: "",
              color: "#3b82f6",
              tag: "",
              enabled: true,
            });
            syncLegacyCalendarFields(this.plugin.settings);
            await this.plugin.saveSettings();
            this.renderExternalCalendars(calendarsContainer);
          }),
      );

    let bulkInput = "";
    let bulkInputComponent: { setValue: (value: string) => void } | null = null;
    new Setting(containerEl)
      .setName("Quick add")
      .setDesc("Paste one or more iCal URLs (comma or newline separated).")
      .addTextArea((text) => {
        bulkInputComponent = text as unknown as {
          setValue: (value: string) => void;
        };
        text
          .setPlaceholder("https://example.com/calendar.ics")
          .onChange((value) => {
            bulkInput = value;
          });
      })
      .addButton((btn) =>
        btn
          .setButtonText("Add URLs")
          .setCta()
          .onClick(async () => {
            const urls = parseExternalCalendarUrls(bulkInput);
            if (!urls.length) return;
            if (!this.plugin.settings.externalCalendars) {
              this.plugin.settings.externalCalendars = [];
            }
            const existing = new Set(
              this.plugin.settings.externalCalendars.map((calendar) => calendar.url),
            );
            urls.forEach((url) => {
              if (existing.has(url)) return;
              this.plugin.settings.externalCalendars.push({
                id: createCalendarId(),
                url,
                color: "#3b82f6",
                tag: "",
                enabled: true,
              });
            });
            syncLegacyCalendarFields(this.plugin.settings);
            await this.plugin.saveSettings();
            bulkInput = "";
            bulkInputComponent?.setValue("");
            this.renderExternalCalendars(calendarsContainer);
          }),
      );

    new Setting(containerEl)
      .setName("External title filter")
      .setDesc("Exclude external events whose titles contain this text")
      .addTextArea((text) =>
        text
          .setPlaceholder("Canceled, Tentative")
          .setValue(this.plugin.settings.externalCalendarFilter || "")
          .onChange(async (value) => {
            this.plugin.settings.externalCalendarFilter = value;
            await this.plugin.saveSettings();
          }),
      );

    const autoSection = containerEl.createEl("div");
    autoSection.createEl("h3", { text: "Auto-create meeting notes" });
    new Setting(autoSection)
      .setName("Enable auto-create meeting notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCreateMeetingNotes)
          .onChange(async (value) => {
            this.plugin.settings.autoCreateMeetingNotes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(autoSection)
      .setName("Meeting note folder")
      .addText((text) =>
        text
          .setPlaceholder("01 Action Items/Events")
          .setValue(this.plugin.settings.meetingNoteFolder || "")
          .onChange(async (value) => {
            this.plugin.settings.meetingNoteFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(autoSection)
      .setName("Meeting note template")
      .addText((text) =>
        text
          .setPlaceholder("System/Templates/Root template.md")
          .setValue(this.plugin.settings.meetingNoteTemplate || "")
          .onChange(async (value) => {
            this.plugin.settings.meetingNoteTemplate = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(autoSection)
      .setName("Sync interval (minutes)")
      .setDesc("How often to check for calendar changes.")
      .addSlider((slider) =>
        slider
          .setLimits(5, 60, 5)
          .setValue(this.plugin.settings.syncIntervalMinutes || 15)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalMinutes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(autoSection)
      .setName("When calendar event is deleted")
      .setDesc("What to do with the meeting note when the event is removed.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("nothing", "Do nothing (keep note)")
          .addOption("archive", "Move to archive folder")
          .addOption("delete", "Delete note")
          .setValue(this.plugin.settings.syncOnEventDelete || "nothing")
          .onChange(async (value) => {
            this.plugin.settings.syncOnEventDelete = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(autoSection)
      .setName("Archive folder")
      .setDesc("Folder to move deleted events (only applies if 'Move to archive' is selected).")
      .addText((text) =>
        text
          .setPlaceholder("Archive/Deleted Events")
          .setValue(this.plugin.settings.archiveFolder || "")
          .onChange(async (value) => {
            this.plugin.settings.archiveFolder = value;
            await this.plugin.saveSettings();
          }),
      );


    containerEl.createEl("h3", { text: "Sidebar default base" });
    new Setting(containerEl)
      .setName("Default calendar base path")
      .setDesc("Path to the base file to open in the right sidebar via command/ribbon.")
      .addText((text) =>
        text
          .setPlaceholder("01 Action Items/Events/Calendar.md")
          .setValue(this.plugin.settings.sidebarBasePath ?? "")
          .onChange(async (value) => {
            this.plugin.settings.sidebarBasePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }

  renderExternalCalendars(container: HTMLElement) {
    container.empty();
    if (!this.plugin.settings.externalCalendars) {
      this.plugin.settings.externalCalendars = [];
    }
    const calendars = this.plugin.settings.externalCalendars;
    const refresh = async () => {
      syncLegacyCalendarFields(this.plugin.settings);
      await this.plugin.saveSettings();
      this.renderExternalCalendars(container);
    };

    if (!calendars.length) {
      const empty = container.createEl("p", {
        text: "No external calendars added yet.",
      });
      empty.style.marginBottom = "12px";
      empty.style.color = "var(--text-muted)";
      return;
    }

    calendars.forEach((calendar, index) => {
      const card = container.createDiv();
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "8px";
      card.style.padding = "12px";
      card.style.marginBottom = "12px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "8px";

      const header = card.createDiv();
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.gap = "8px";

      const title = header.createEl("strong", {
        text: calendar.url ? `Calendar ${index + 1}` : "New calendar",
      });
      title.style.flex = "1";

      const move = (from: number, to: number) => {
        [calendars[from], calendars[to]] = [calendars[to], calendars[from]];
      };

      const controls = header.createDiv();
      controls.style.display = "flex";
      controls.style.gap = "4px";

      const upBtn = controls.createEl("button", { text: "↑" });
      upBtn.className = "mod-cta";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", async () => {
        if (index === 0) return;
        move(index, index - 1);
        await refresh();
      });

      const downBtn = controls.createEl("button", { text: "↓" });
      downBtn.className = "mod-cta";
      downBtn.disabled = index === calendars.length - 1;
      downBtn.addEventListener("click", async () => {
        if (index >= calendars.length - 1) return;
        move(index, index + 1);
        await refresh();
      });

      const deleteBtn = controls.createEl("button", { text: "Delete" });
      deleteBtn.className = "mod-warning";
      deleteBtn.addEventListener("click", async () => {
        calendars.splice(index, 1);
        await refresh();
      });

      new Setting(card)
        .setName("Enabled")
        .setDesc("Toggle this calendar on/off without removing it.")
        .addToggle((toggle) =>
          toggle
            .setValue(calendar.enabled !== false)
            .onChange(async (value) => {
              calendar.enabled = value;
              await refresh();
            }),
        );

      new Setting(card)
        .setName("iCal URL")
        .setDesc("Paste the full .ics URL for this calendar.")
        .addText((text) =>
          text
            .setPlaceholder("https://example.com/calendar.ics")
            .setValue(calendar.url || "")
            .onChange(async (value) => {
              calendar.url = value.trim();
              await refresh();
            }),
        );

      new Setting(card)
        .setName("Color")
        .setDesc("Calendar color for external events.")
        .addColorPicker((picker) =>
          picker
            .setValue(calendar.color || "#3b82f6")
            .onChange(async (value) => {
              calendar.color = value;
              await refresh();
            }),
        );

      new Setting(card)
        .setName("Auto-create tag")
        .setDesc("Tag to apply when creating meeting notes from this calendar.")
        .addText((text) =>
          text
            .setPlaceholder("tag-name (optional)")
            .setValue(calendar.tag || "")
            .onChange(async (value) => {
              calendar.tag = value.trim();
              await refresh();
            }),
        );
    });
  }

  renderCalendarStyleRules(container: HTMLElement) {
    container.empty();
    if (!this.plugin.settings.calendarStyleRules) {
      this.plugin.settings.calendarStyleRules = [];
    }
    const rules = this.plugin.settings.calendarStyleRules;
    const refresh = async () => {
      await this.plugin.saveSettings();
      this.renderCalendarStyleRules(container);
    };

    rules.forEach((rule, index) => {
      if (!rule.conditions || !rule.conditions.length) {
        rule.conditions = [createDefaultCondition()];
      }
      rule.match = rule.match || DEFAULT_MATCH;

      const card = container.createDiv({ cls: "calendar-style-rule-card" });
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "6px";
      card.style.padding = "12px";
      card.style.marginBottom = "12px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "10px";

      const header = card.createDiv();
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.gap = "12px";

      const activeWrap = header.createEl("label");
      activeWrap.style.display = "flex";
      activeWrap.style.alignItems = "center";
      activeWrap.style.gap = "6px";
      const activeToggle = activeWrap.createEl("input", { type: "checkbox" });
      activeToggle.checked = rule.active !== false;
      activeToggle.addEventListener("change", async () => {
        rule.active = activeToggle.checked;
        await refresh();
      });
      activeWrap.createEl("span", { text: "Active" });

      const labelInput = header.createEl("input", {
        type: "text",
        value: rule.label || `Rule ${index + 1}`,
        placeholder: "Rule label",
        cls: "calendar-rule-label-input",
      }) as HTMLInputElement;
      labelInput.style.flex = "1";
      labelInput.addEventListener("change", async () => {
        rule.label = labelInput.value.trim();
        await refresh();
      });

      const controlGroup = header.createDiv();
      controlGroup.style.display = "flex";
      controlGroup.style.gap = "4px";

      const move = (from: number, to: number) => {
        [rules[from], rules[to]] = [rules[to], rules[from]];
      };

      const up = controlGroup.createEl("button", { text: "↑" });
      up.className = "mod-cta";
      up.disabled = index === 0;
      up.addEventListener("click", async () => {
        if (index === 0) return;
        move(index, index - 1);
        await refresh();
      });

      const down = controlGroup.createEl("button", { text: "↓" });
      down.className = "mod-cta";
      down.disabled = index === rules.length - 1;
      down.addEventListener("click", async () => {
        if (index >= rules.length - 1) return;
        move(index, index + 1);
        await refresh();
      });

      const duplicateBtn = controlGroup.createEl("button", { text: "Duplicate" });
      duplicateBtn.className = "mod-cta";
      duplicateBtn.addEventListener("click", async () => {
        const duplicated = cloneRule(rule);
        duplicated.id = createRuleId();
        duplicated.label = duplicated.label
          ? `${duplicated.label} copy`
          : `Rule ${rules.length + 1}`;
        rules.splice(index + 1, 0, duplicated);
        await refresh();
      });

      const deleteBtn = controlGroup.createEl("button", { text: "Delete" });
      deleteBtn.className = "mod-warning";
      deleteBtn.addEventListener("click", async () => {
        rules.splice(index, 1);
        await refresh();
      });

      new Setting(card)
        .setName("Color")
        .setDesc("Optional hex color for the event block")
        .addColorPicker((picker) =>
          picker
            .setValue(rule.color || "#ffffff")
            .onChange(async (value) => {
              rule.color = value;
              await refresh();
            }),
        );

      const textStyleSetting = new Setting(card)
        .setName("Text style")
        .setDesc("Select built-in styles or add custom classes.");
      {
        const presetValues = new Set(
          TEXT_STYLE_PRESETS.map((preset) => preset.value),
        );
        const tokens = parseTextStyleTokens(rule.textStyle);
        const selectedPresets = new Set(
          tokens.filter((token) => presetValues.has(token)),
        );
        const customTokens = tokens.filter((token) => !presetValues.has(token));

        const controls = textStyleSetting.controlEl.createDiv();
        controls.style.display = "flex";
        controls.style.flexWrap = "wrap";
        controls.style.gap = "8px";
        controls.style.alignItems = "center";

        let customInput: HTMLInputElement;
        const updateStyle = async (nextCustomValue?: string) => {
          const customValue =
            nextCustomValue !== undefined
              ? nextCustomValue
              : customInput.value;
          const custom = parseTextStyleTokens(customValue).filter(
            (token) => !presetValues.has(token),
          );
          rule.textStyle = buildTextStyleValue([
            ...Array.from(selectedPresets),
            ...custom,
          ]);
          await refresh();
        };

        TEXT_STYLE_PRESETS.forEach((preset) => {
          const label = controls.createEl("label");
          label.style.display = "flex";
          label.style.alignItems = "center";
          label.style.gap = "4px";
          const checkbox = label.createEl("input", { type: "checkbox" });
          checkbox.checked = selectedPresets.has(preset.value);
          checkbox.addEventListener("change", async () => {
            if (checkbox.checked) {
              selectedPresets.add(preset.value);
            } else {
              selectedPresets.delete(preset.value);
            }
            await updateStyle();
          });
          label.createEl("span", { text: preset.label });
        });

        customInput = controls.createEl("input");
        customInput.type = "text";
        customInput.placeholder = "custom-class, another";
        customInput.value = customTokens.join(", ");
        customInput.style.minWidth = "180px";

        customInput.addEventListener("change", async () => {
          await updateStyle(customInput.value);
        });
      }

      new Setting(card)
        .setName("Match logic")
        .setDesc("Determine whether all or any conditions must match")
        .addDropdown((dropdown) => {
          MATCH_OPTIONS.forEach((option) => {
            dropdown.addOption(option.value, option.label);
          });
          dropdown.setValue(rule.match || DEFAULT_MATCH);
          dropdown.onChange(async (value) => {
            rule.match = value as CalendarStyleMatch;
            await refresh();
          });
        });

      const conditionsContainer = card.createDiv();
      conditionsContainer.style.display = "flex";
      conditionsContainer.style.flexDirection = "column";
      conditionsContainer.style.gap = "8px";

      const renderConditions = () => {
        conditionsContainer.empty();
        rule.conditions!.forEach((condition, condIndex) => {
          const row = conditionsContainer.createDiv();
          row.style.display = "grid";
          row.style.gridTemplateColumns = "1fr 1fr 1fr auto";
          row.style.gap = "6px";

          const fieldSelect = row.createEl("select");
          CONDITION_FIELDS.forEach((field) => {
            const opt = fieldSelect.createEl("option", {
              value: field.value,
              text: field.label,
            });
            if (condition.field === field.value) opt.setAttr("selected", "");
          });
          fieldSelect.addEventListener("change", async () => {
            condition.field = fieldSelect.value as CalendarField;
            condition.operator = "is";
            condition.value = "";
            await refresh();
          });

          const operatorSelect = row.createEl("select");
          getOperatorOptions(condition.field).forEach((op) => {
            const opt = operatorSelect.createEl("option", {
              value: op,
              text: OPERATOR_LABELS[op],
            });
            if (condition.operator === op) opt.setAttr("selected", "");
          });
          operatorSelect.addEventListener("change", async () => {
            condition.operator = operatorSelect.value as CalendarOperator;
            await refresh();
          });

          const valueInput = row.createEl("input");
          valueInput.type = "text";
          valueInput.value = condition.value;
          valueInput.placeholder = getConditionPlaceholder(condition.field);
          valueInput.disabled = shouldDisableValueInput(condition.operator);
          valueInput.addEventListener("change", async () => {
            condition.value = valueInput.value.trim();
            await refresh();
          });

          const removeBtn = row.createEl("button", { text: "×" });
          removeBtn.className = "mod-ghost";
          removeBtn.addEventListener("click", async () => {
            if (rule.conditions!.length <= 1) {
              rule.conditions = [createDefaultCondition()];
            } else {
              rule.conditions!.splice(condIndex, 1);
            }
            await refresh();
          });

          row.appendChild(fieldSelect);
          row.appendChild(operatorSelect);
          row.appendChild(valueInput);
          row.appendChild(removeBtn);
          conditionsContainer.appendChild(row);
        });

        const addRow = conditionsContainer.createDiv();
        addRow.style.display = "flex";
        addRow.style.alignItems = "center";
        addRow.style.gap = "6px";

        const addBtn = addRow.createEl("button", { text: "+ Condition" });
        addBtn.className = "mod-cta";
        addBtn.addEventListener("click", async () => {
          rule.conditions!.push(createDefaultCondition());
          await refresh();
        });
      };

      renderConditions();
      container.appendChild(card);
    });
  }
}
