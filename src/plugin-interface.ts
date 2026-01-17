import { AutoCreateService } from "./services/auto-create-service";

export interface CalendarPluginBridge {
  getCalendarStyleOverride(status?: string, priority?: string): { color?: string; textStyle?: string } | null;
  getDefaultCondenseLevel(): number;
  getExternalCalendarUrls(): string[];
  getExternalCalendarFilter(): string;
  getCalendarColor(url: string): string;
  getCalendarTag(url: string): string;
  getHiddenEvents(): string[];
  addHiddenEvent(eventId: string): Promise<void>;
  removeHiddenEvent(eventId: string): Promise<void>;
  getPriorityValues(): string[];
  getStatusValues(): string[];
  settings: any;
  autoCreateService: AutoCreateService;
}
