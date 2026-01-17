import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../styles.css";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventMountArg,
  DatesSetArg,
  DayHeaderContentArg,
  DayCellContentArg,
} from "@fullcalendar/core";
import { BasesEntry, BasesPropertyId, Platform, Value, App } from "obsidian";
import { useApp } from "./hooks";
import * as logger from "./logger";
import {
  calculateSlotHeightFromZoom,
  calculateSlotZoom,
  DEFAULT_CONDENSE_LEVEL,
  DEFAULT_PRIORITY_COLOR_MAP,
  DEFAULT_STATUS_STYLE_MAP,
} from "./utils";
import { ExternalCalendarEvent } from "./external-calendar-service";

const DEFAULT_SLOT_MIN_TIME = "00:00:00";
const DEFAULT_SLOT_MAX_TIME = "24:00:00";
const DEFAULT_SCROLL_TIME = "08:00:00";
const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];

const HEADER_HEIGHT_VAR = "var(--tps-bases-header-height, 84px)";
type ViewMode = "day" | "3d" | "5d" | "7d" | "week" | "month" | "continuous";

export interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
  title?: string;
  isGhost?: boolean;
  ghostDate?: Date;
  isExternal?: boolean;
  externalEvent?: ExternalCalendarEvent;
  color?: string;
  isHidden?: boolean;
  status?: string;
  priority?: string;
  style?: string;

  // Pre-calculated styles to avoid logic in View
  cssClasses?: string[];
  backgroundColor?: string;
  borderColor?: string;
}

interface CalendarReactViewProps {
  entries: CalendarEntry[];
  weekStartDay: number;
  properties: BasesPropertyId[];
  onEntryClick: (entry: CalendarEntry, isModEvent: boolean) => void;
  onEntryContextMenu: (evt: React.MouseEvent, entry: BasesEntry) => void;
  onEventDrop?: (
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope?: "all" | "single",
    oldStart?: Date,
    oldEnd?: Date,
  ) => Promise<void>;
  onEventResize?: (
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope?: "all" | "single",
    oldStart?: Date,
    oldEnd?: Date,
  ) => Promise<void>;
  onCreateSelection?: (start: Date, end: Date) => Promise<void>;
  onExternalDrop?: (filePath: string, start: Date, allDay: boolean) => Promise<void>;
  editable: boolean;

  condenseLevel?: number;
  onCondenseLevelChange?: (level: number) => void;
  showFullDay?: boolean;
  viewMode: ViewMode;
  slotRange?: { min: string; max: string };
  navStep?: number;
  onToggleFullDay?: () => void;
  allDayProperty?: BasesPropertyId | null;
  initialDate?: Date;
  currentDate?: Date;
  onDateChange?: (date: Date) => void;
  showHiddenHoursToggle?: boolean;
  defaultEventDuration?: number; // Duration in minutes for external drops
  onDateClick?: (date: Date) => void;
  // showHiddenEvents?: boolean;
  // onToggleHiddenEvents?: () => void;
  onDateMouseEnter?: (date: Date, targetEl: HTMLElement, event: MouseEvent) => void;
  headerContainer?: HTMLElement;
  showNavButtons?: boolean;
  onDateSelectorClick?: () => void;
  headerPortalTarget?: HTMLElement | null; // New prop for portal
}

const isDateValue = (value: unknown): value is { date: Date; time?: boolean } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "date" in value &&
    (value as any).date instanceof Date
  );
};

const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    if ("data" in (value as object)) {
      return normalizeValue((value as { data: unknown }).data);
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => normalizeValue(item))
        .filter(Boolean)
        .join(", ");
    }
    if (isDateValue(value)) {
      return value.date ? value.date.toISOString() : "";
    }
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
};

const normalizeDisplayTitle = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return trimmed;
  return trimmed.replace(/ \\d{4}-\\d{2}-\\d{2}$/, "");
};

const tryGetValue = (
  entry: BasesEntry,
  propId: BasesPropertyId,
): Value | null => {
  try {
    return entry.getValue(propId);
  } catch {
    return null;
  }
};

export const CalendarReactView: React.FC<CalendarReactViewProps> = ({
  entries,
  weekStartDay,
  properties,
  onEntryClick,
  onEntryContextMenu,
  onEventDrop,
  onEventResize,
  onCreateSelection,
  onExternalDrop,
  editable,

  condenseLevel,
  onCondenseLevelChange,
  showFullDay,
  viewMode,
  slotRange,
  navStep,
  onToggleFullDay,
  allDayProperty,
  initialDate,
  currentDate,
  onDateChange,
  showHiddenHoursToggle = true,
  defaultEventDuration = 60,
  onDateClick,
  headerContainer,
  showNavButtons,
  // showHiddenEvents,
  // onToggleHiddenEvents,
  onDateMouseEnter,
  onDateSelectorClick,
  headerPortalTarget, // New prop
}) => {
  const app = useApp() || ((window as any).app as App);
  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [localShowFullDay, setLocalShowFullDay] = useState(
    showFullDay ?? true,
  );
  const [isTodayVisible, setIsTodayVisible] = useState(true);
  const [headerTitle, setHeaderTitle] = useState("");
  const [hiddenTimeVisible, setHiddenTimeVisible] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isInternalDragging, setIsInternalDragging] = useState(false);
  const [isMobileNavHidden, setIsMobileNavHidden] = useState(false);

  // Continuous View State
  const [continuousStart, setContinuousStart] = useState(currentDate || new Date());
  const [continuousDays, setContinuousDays] = useState<Date[]>([]);
  const continuousContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isPrependingRef = useRef(false);

  // Restore scroll position after prepend
  useLayoutEffect(() => {
    if (viewMode === 'continuous' && continuousContainerRef.current && isPrependingRef.current) {
      const el = continuousContainerRef.current;
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      if (heightDiff > 0) {
        el.scrollTop += heightDiff;
      }
      isPrependingRef.current = false;
    }
  }, [continuousDays, viewMode]);

  // Initialize continuous days on mount or date change
  useEffect(() => {
    if (viewMode === 'continuous') {
      const base = currentDate || new Date();
      const days = [];
      // Initialize with 5 days: -2 to +2
      for (let i = -2; i <= 2; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        days.push(d);
      }
      setContinuousDays(days);
      setContinuousStart(days[0]);

      // Scroll to center after render
      setTimeout(() => {
        if (continuousContainerRef.current) {
          const centerEl = continuousContainerRef.current.children[2] as HTMLElement;
          if (centerEl) {
            continuousContainerRef.current.scrollTop = centerEl.offsetTop - 50;
          }
        }
      }, 50);
    }
  }, [viewMode, currentDate]);

  const handleContinuousScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const threshold = 200; // px

    // Check top
    if (el.scrollTop < threshold) {
      prevScrollHeightRef.current = el.scrollHeight;
      isPrependingRef.current = true;
      setContinuousDays(prev => {
        const newDay = new Date(prev[0]);
        newDay.setDate(newDay.getDate() - 1);
        // Limit total days to 14 to prevent memory issues, remove from bottom
        const next = [newDay, ...prev];
        if (next.length > 14) next.pop();
        return next;
      });
    }

    // Check bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      setContinuousDays(prev => {
        const newDay = new Date(prev[prev.length - 1]);
        newDay.setDate(newDay.getDate() + 1);
        const next = [...prev, newDay];
        if (next.length > 14) next.shift();
        return next;
      });
    }
  }, []);

  const dragCounterRef = useRef(0);

  // Touch swipe tracking for mobile navigation - DISABLED (no longer needed)
  // const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    type: 'drop' | 'resize';
    info: any;
    entry: BasesEntry;
    newStart: Date;
    newEnd: Date | null;
    allDay: boolean;
    oldStart?: Date;
    oldEnd?: Date;
  } | null>(null);

  const [pendingCreation, setPendingCreation] = useState<{
    start: Date;
    end: Date;
  } | null>(null);

  // Tick for updating "past" status
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Detect mobile platform
  const isMobile = Platform.isMobile;
  const mobileNavHidden = isInternalDragging || isMobileNavHidden;
  const showFloatingNav = !(showNavButtons === false);
  const floatingNavStyle: React.CSSProperties = {
    position: 'fixed',
    top: `calc(${HEADER_HEIGHT_VAR} + env(safe-area-inset-top, 0px) + 8px)`,
    bottom: 'auto',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'var(--background-primary)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: '20px',
    padding: '4px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    flexWrap: 'nowrap',
    minWidth: 0,
    pointerEvents: 'auto',
    zIndex: 10010,
  };

  const safeWeekStartDay = Number.isFinite(weekStartDay)
    ? Math.max(0, Math.min(6, weekStartDay))
    : 1;
  const targetDayCount =
    viewMode === "day" ? 1 :
      viewMode === "3d" ? 3 :
        viewMode === "5d" ? 5 :
          viewMode === "7d" ? 7 :
            viewMode === "week" ? 7 :
              7;

  const viewName =
    viewMode === "month" ? "dayGridMonth" :
      viewMode === "week" ? "timeGridWeek" :
        viewMode === "day" ? "timeGridDay" :
          viewMode === "continuous" ? "timeGridDay" : // Use day view for continuous blocks
            `timeGridRange-${targetDayCount}`;

  const navStepValue = typeof navStep === "number" ? navStep : 0;
  // Force full-range navigation for week-like views
  const isWeekView = viewMode === "week" || viewMode === "7d";

  const resolvedNavDays =
    !isWeekView && Number.isFinite(navStepValue) && navStepValue > 0
      ? Math.round(navStepValue)
      : targetDayCount;

  // Center the initial date in the view (for non-month views)
  // Determine the true initial date only once on mount
  const initialDateRef = useRef<Date | null>(null);

  // When switching view modes, re-evaluate the initial date so "3d/5d/7d" can
  // center the current focus day and "week" can snap to a real week view.
  const lastViewModeRef = useRef<ViewMode | null>(null);
  if (lastViewModeRef.current !== viewMode) {
    lastViewModeRef.current = viewMode;
    initialDateRef.current = null;
  }

  if (!initialDateRef.current) {
    if (initialDate) {
      initialDateRef.current = initialDate;
    } else {
      // We only want the *very first* available date or today
      // We intentionally do NOT listen to subsequent updates to 'entries' for this
      // to avoid the calendar jumping around or re-mounting.
      const baseDate = currentDate ?? entries[0]?.startDate ?? new Date();

      if (viewMode === "month") {
        initialDateRef.current = baseDate;
      } else {
        const offset = Math.floor((targetDayCount - 1) / 2);
        const centered = new Date(baseDate);
        centered.setHours(0, 0, 0, 0);
        centered.setDate(centered.getDate() - offset);
        initialDateRef.current = centered;
      }
    }
  }

  const safeInitialDate = initialDateRef.current!;
  const resolvedShowFullDay =
    typeof showFullDay === "boolean" ? showFullDay : localShowFullDay;
  const hasCustomSlotRange = !!slotRange && (
    slotRange.min !== DEFAULT_SLOT_MIN_TIME ||
    slotRange.max !== DEFAULT_SLOT_MAX_TIME
  );
  const slotMinTimeValue = hiddenTimeVisible
    ? DEFAULT_SLOT_MIN_TIME
    : slotRange?.min ?? DEFAULT_SLOT_MIN_TIME;
  const slotMaxTimeValue = hiddenTimeVisible
    ? DEFAULT_SLOT_MAX_TIME
    : slotRange?.max ?? DEFAULT_SLOT_MAX_TIME;



  const effectiveCondenseLevel = condenseLevel ?? DEFAULT_CONDENSE_LEVEL;
  const zoom = calculateSlotZoom(effectiveCondenseLevel);
  const computedSlotHeight = calculateSlotHeightFromZoom(zoom);

  useEffect(() => {
    const api = calendarRef.current?.getApi();


    // Scope CSS variables to the container instead of document root
    if (containerRef.current) {
      // CSS variables are now set on the container style prop directly
      containerRef.current.style.setProperty('--calendar-slot-height', `${computedSlotHeight}px`);
    }

    if (api) {
      api.updateSize();
    }
  }, [effectiveCondenseLevel, resolvedShowFullDay, viewMode]);

  useEffect(() => {
    if (typeof showFullDay === "boolean") {
      setLocalShowFullDay(showFullDay);
    }
  }, [showFullDay]);

  useEffect(() => {
    if (!slotRange) {
      setHiddenTimeVisible(false);
    }
  }, [slotRange]);

  // Handle container resizing to ensure FullCalendar updates its layout
  useEffect(() => {
    if (!containerRef.current || !calendarRef.current) return;

    const calendarApi = calendarRef.current.getApi();

    // Force update after mount to handle initial layout settlement with staggered checks
    const timeouts = [50, 200, 500].map(delay =>
      setTimeout(() => {
        if (calendarRef.current) {
          calendarRef.current.getApi().updateSize();
        }
      }, delay)
    );

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (calendarRef.current) {
          calendarRef.current.getApi().updateSize();
        }
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      timeouts.forEach(clearTimeout);
    };
  }, []);

  // Handle window resize (fallback)
  useEffect(() => {
    const handleResize = () => {
      if (calendarRef.current) {
        calendarRef.current.getApi().updateSize();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Sync current date if provided from outside
  useEffect(() => {
    if (currentDate && calendarRef.current) {
      const api = calendarRef.current.getApi();
      if (api.getDate().getTime() !== currentDate.getTime()) {
        api.gotoDate(currentDate);
      }
    }
  }, [currentDate]);

  const normalizedDayCount = targetDayCount;

  // Better: Create a map of Path -> BasesEntry
  const basesEntryMap = useMemo(() => {
    const map = new Map<string, BasesEntry>();
    entries.forEach(ce => {
      if (ce.entry?.file?.path) {
        map.set(ce.entry.file.path, ce.entry);
      }
    });
    return map;
  }, [entries]);

  const events = useMemo(
    () => {
      const now = new Date();
      const generatedEvents = entries.map((calEntry) => {
        const startDate = new Date(calEntry.startDate);
        const endDate = calEntry.endDate
          ? new Date(calEntry.endDate)
          : new Date(startDate.getTime() + 60 * 60 * 1000);

        // Use pre-calculated classes and colors
        const classNames = [...(calEntry.cssClasses || [])];
        const effectiveColor = calEntry.isExternal ? (calEntry.color || "#3788d8") : (calEntry.backgroundColor || DEFAULT_PRIORITY_COLOR_MAP.normal);
        const backgroundColor = effectiveColor;
        const borderColor = calEntry.borderColor || backgroundColor;

        const allDaySource = allDayProperty
          ? tryGetValue(calEntry.entry, allDayProperty)
          : null;
        const normalizedAllDaySource = normalizeValue(allDaySource).trim().toLowerCase();
        const explicitAllDay = ["true", "yes", "y", "1"].includes(
          normalizedAllDaySource,
        );

        const isAllDay = explicitAllDay; // Simplify for now

        // Determine title
        const baseTitle = calEntry.title || calEntry.entry?.file?.basename || "Untitled";
        const title = calEntry.isGhost ? `${baseTitle} (upcoming)` : baseTitle;

        return {
          id: calEntry.isGhost
            ? `ghost-${(calEntry.entry as any).path}-${startDate.getTime()}`
            : ((calEntry.entry as any).file?.path + (calEntry.isExternal ? "" : `-${backgroundColor}`)),
          title,
          start: startDate,
          end: endDate,
          allDay: isAllDay,
          classNames,
          extendedProps: {
            entryPath: (calEntry.entry as any).file?.path,
            calEntryTitle: calEntry.title,
            status: calEntry.status,
            priorityColor: backgroundColor,
            isGhost: calEntry.isGhost,
            ghostDate: calEntry.ghostDate ? calEntry.ghostDate.toISOString() : undefined,
          },
          display: "block",
          backgroundColor: calEntry.isGhost ? "rgba(100, 100, 100, 0.3)" : backgroundColor,
          borderColor: calEntry.isGhost ? "rgba(100, 100, 100, 0.5)" : borderColor,
          textColor: "#ffffff",
          "data-priority-color": backgroundColor,
        };
      });

      return generatedEvents;
    },
    [
      entries,
      allDayProperty,
      tick,
    ],
  );

  const handleEventClick = useCallback(
    (clickInfo: EventClickArg) => {
      clickInfo.jsEvent.preventDefault();

      // Resolve the calendar entry from the list
      const entryPath = clickInfo.event.extendedProps.entryPath;
      const eventStart = clickInfo.event.start;

      const entry = entries.find(e =>
        e.entry.file.path === entryPath &&
        (!eventStart || Math.abs(e.startDate.getTime() - eventStart.getTime()) < 1000)
      );

      const isModEvent = clickInfo.jsEvent.ctrlKey || clickInfo.jsEvent.metaKey;
      if (!entry) return;

      if (Platform.isMobile) {
        const syntheticEvent = {
          nativeEvent: clickInfo.jsEvent,
          currentTarget: clickInfo.el,
          target: clickInfo.el,
          preventDefault: () => clickInfo.jsEvent.preventDefault(),
          stopPropagation: () => clickInfo.jsEvent.stopPropagation(),
        } as unknown as React.MouseEvent;
        // Attach FullCalendar event info for context menu to access (Fix for TypeError)
        (syntheticEvent.nativeEvent as any).fullCalendarEvent = clickInfo.event;
        // Context menu still expects BasesEntry because it works on files
        onEntryContextMenu(syntheticEvent, entry.entry);
        return;
      }
      onEntryClick(entry, isModEvent);
    },
    [onEntryClick, onEntryContextMenu, entries],
  );

  // Debounce hover ref
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleEventMouseEnter = useCallback(
    (mouseEnterInfo: { event: any; el: HTMLElement; jsEvent: MouseEvent }) => {
      const entryPath = mouseEnterInfo.event.extendedProps.entryPath;
      const entry = entryPath ? basesEntryMap.get(entryPath) : undefined;

      if (!entry) return;

      // Clear any existing timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      // Debounce the hover trigger to prevent flickering
      hoverTimeoutRef.current = setTimeout(() => {
        if (app && entry) {
          app.workspace.trigger("hover-link", {
            event: mouseEnterInfo.jsEvent,
            source: "bases",
            hoverParent: app.renderContext,
            targetEl: mouseEnterInfo.el,
            linktext: entry.file.path,
          });
        }
      }, 300); // 300ms delay

      const contextMenuHandler = (evt: Event) => {
        evt.preventDefault();
        evt.stopPropagation();
        if ("stopImmediatePropagation" in evt) {
          (evt as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
        }
        // Attach FullCalendar event info for context menu to access
        (evt as any).fullCalendarEvent = mouseEnterInfo.event;
        const syntheticEvent = {
          nativeEvent: evt as MouseEvent,
          currentTarget: mouseEnterInfo.el,
          target: evt.target as HTMLElement,
          preventDefault: () => evt.preventDefault(),
          stopPropagation: () => evt.stopPropagation(),
        } as unknown as React.MouseEvent;
        // Attach to synthetic event as well for good measure, though the handler mainly reads from nativeEvent or evt
        (syntheticEvent.nativeEvent as any).fullCalendarEvent = mouseEnterInfo.event;
        if (entry) {
          onEntryContextMenu(syntheticEvent, entry);
        }
      };

      mouseEnterInfo.el.addEventListener("contextmenu", contextMenuHandler, true);
    },
    [app, onEntryContextMenu, basesEntryMap],
  );

  const handleEventMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const handleDrop = useCallback(
    async (dropInfo: EventDropArg) => {
      const allDay = dropInfo.event.allDay;
      if (!onEventDrop) {
        dropInfo.revert();
        return;
      }

      const entryPath = dropInfo.event.extendedProps.entryPath;
      const entry = entryPath ? basesEntryMap.get(entryPath) : undefined;

      if (!entry) {
        dropInfo.revert();
        return;
      }

      const newStart = dropInfo.event.start;
      const newEnd = dropInfo.event.end;
      if (!newStart) {
        dropInfo.revert();
        return;
      }

      const oldStart = dropInfo.oldEvent?.start ?? undefined;
      const oldEnd = dropInfo.oldEvent?.end ?? undefined;

      // Store the pending change for confirmation
      setPendingChange({
        type: 'drop',
        info: dropInfo,
        entry,
        newStart,
        newEnd: newEnd ?? newStart,
        allDay,
        oldStart,
        oldEnd,
      });
    },
    [onEventDrop, basesEntryMap],
  );

  const handleResize = useCallback(
    async (resizeInfo: any) => {
      if (!onEventResize) {
        resizeInfo.revert();
        return;
      }
      const entryPath = resizeInfo.event.extendedProps.entryPath;
      const entry = entryPath ? basesEntryMap.get(entryPath) : undefined;

      if (!entry) {
        resizeInfo.revert();
        return;
      }

      const newStart = resizeInfo.event.start;
      const newEnd = resizeInfo.event.end;
      if (!newStart || !newEnd) {
        resizeInfo.revert();
        return;
      }

      const oldStart = resizeInfo.oldEvent?.start ?? undefined;
      const oldEnd = resizeInfo.oldEvent?.end ?? undefined;

      // Store the pending change for confirmation
      setPendingChange({
        type: 'resize',
        info: resizeInfo,
        entry,
        newStart,
        newEnd,
        allDay: resizeInfo.event.allDay,
        oldStart,
        oldEnd,
      });
    },
    [onEventResize, basesEntryMap],
  );

  const confirmChangeWithScope = useCallback(async (scope: "all" | "single") => {
    if (!pendingChange) return;

    try {
      if (pendingChange.type === 'drop' && onEventDrop) {
        await onEventDrop(
          pendingChange.entry,
          pendingChange.newStart,
          pendingChange.newEnd ?? undefined,
          pendingChange.allDay,
          scope,
          pendingChange.oldStart,
          pendingChange.oldEnd ?? undefined,
        );
      } else if (pendingChange.type === 'resize' && onEventResize) {
        await onEventResize(
          pendingChange.entry,
          pendingChange.newStart,
          pendingChange.newEnd ?? undefined,
          pendingChange.allDay,
          scope,
          pendingChange.oldStart,
          pendingChange.oldEnd ?? undefined,
        );
      }
      setPendingChange(null);
    } catch (error) {
      logger.error(error);
      pendingChange.info.revert();
      setPendingChange(null);
    }
  }, [pendingChange, onEventDrop, onEventResize]);

  const handleCancelChange = useCallback(() => {
    if (!pendingChange) return;
    pendingChange.info.revert();
    setPendingChange(null);
  }, [pendingChange]);

  const formatTime = useCallback((date: Date) => {
    return `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes(),
    ).padStart(2, "0")}`;
  }, []);

  const updateTimeLabels = useCallback(
    (event: any, element: HTMLElement) => {
      const start = event.start;
      const end = event.end;
      const topLabel = element.querySelector(".bases-calendar-time-top") as HTMLElement;
      const bottomLabel = element.querySelector(".bases-calendar-time-bottom") as HTMLElement;
      if (!topLabel || !bottomLabel || !start || !end) return;
      topLabel.textContent = formatTime(start);
      bottomLabel.textContent = formatTime(end);
    },
    [formatTime],
  );

  const setLabelsVisible = useCallback((element: HTMLElement, visible: boolean) => {
    const labels = element.querySelectorAll(
      ".bases-calendar-time-top, .bases-calendar-time-bottom",
    );
    labels.forEach((label) => {
      if (visible) {
        label.classList.add("is-visible");
      } else {
        label.classList.remove("is-visible");
      }
    });
  }, []);

  const handleEventMount = useCallback(
    (arg: EventMountArg) => {
      const element = arg.el;
      const event = arg.event;
      if (!element) return;

      const priorityColor = (event.extendedProps.priorityColor as string | undefined) ?? "";
      if (priorityColor) {
        element.style.setProperty("--priority-color", priorityColor);
      }

      // Inject data-path and class for Global Context Menu integration
      if (event.extendedProps.entryPath) {
        element.setAttribute('data-path', event.extendedProps.entryPath);
        element.classList.add('tps-calendar-entry');
      }

      // WORKAROUND: Since eventContent callback might not be invoked for some events, manual inject title check
      // Find or create the fc-event-main-frame or fc-event-main container
      const mainFrame = element.querySelector('.fc-event-main-frame') || element.querySelector('.fc-event-main');
      if (mainFrame) {
        // Check if we already have our custom content
        if (!mainFrame.querySelector('.bases-calendar-event-content')) {
          // We can't render properties here easily without the entry, but we can ensure title
          const displayTitle = event.title || 'Untitled';
          // Only inject if it looks empty
          if (!mainFrame.textContent?.trim()) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'bases-calendar-event-content';
            contentDiv.innerHTML = `<div class="bases-calendar-event-title">${displayTitle}</div>`;
            mainFrame.appendChild(contentDiv); // Append instead of insertBefore for safety
          }
        }
      }

      let top = element.querySelector(".bases-calendar-time-top") as HTMLElement;
      let bottom = element.querySelector(".bases-calendar-time-bottom") as HTMLElement;
      if (!top) {
        top = document.createElement("div");
        top.className = "bases-calendar-time-top";
        element.prepend(top);
      }
      if (!bottom) {
        bottom = document.createElement("div");
        bottom.className = "bases-calendar-time-bottom";
        element.append(bottom);
      }

      // Initial update
      updateTimeLabels(event, element);
      setLabelsVisible(element, false);

      // Add context menu listener
      const contextMenuHandler = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const entry = event.extendedProps.entry as BasesEntry;
        if (entry && onEntryContextMenu) {
          // Attach FullCalendar event to the mouse event for the handler to use
          (e as any).fullCalendarEvent = event;
          const syntheticEvent = {
            nativeEvent: e,
            currentTarget: element,
            target: e.target as HTMLElement,
            preventDefault: () => e.preventDefault(),
            stopPropagation: () => e.stopPropagation(),
          } as unknown as React.MouseEvent;
          (syntheticEvent.nativeEvent as any).fullCalendarEvent = event;
          onEntryContextMenu(syntheticEvent, entry);
        }
      };
      element.addEventListener('contextmenu', contextMenuHandler);

      // Cleanup listener on unmount (FullCalendar handles element removal, but good practice)
      // Actually, since we don't have a clean unmount hook for individual elements easily exposed here without keeping refs,
      // and the element is destroyed by FullCalendar, it's generally fine.
      // But we can store it on the element if we wanted to be strict.
    },
    [setLabelsVisible, updateTimeLabels, onEntryContextMenu],
  );

  const handleDayMount = useCallback((arg: any) => {
    const { date, el } = arg;
    const link = el.querySelector('a.fc-col-header-cell-cushion, a.fc-daygrid-day-number');
    if (link) {
      link.addEventListener('mouseenter', (e: MouseEvent) => {
        if (onDateMouseEnter) onDateMouseEnter(date, link as HTMLElement, e);
      });
    }

    // On mobile, inject navigation arrows into the first day header cell
    if (Platform.isMobile) {
      // Mobile header injection removed in favor of floating controls
    }
  }, [onDateMouseEnter, viewMode, resolvedNavDays, onDateChange]);

  const handleEventWillUnmount = useCallback((arg: EventMountArg) => {
    const element = arg.el;
    const observer = (element as any)._timeObserver as MutationObserver | undefined;
    if (observer) {
      observer.disconnect();
      delete (element as any)._timeObserver;
    }
  }, []);

  const handleDragStart = useCallback(
    (info: any) => {
      setIsInternalDragging(true);
      const element = info.el;
      const event = info.event;
      if (event.allDay) return;

      // Start observing for style changes during drag
      const observer = new MutationObserver(() => updateTimeLabels(event, element));
      observer.observe(element, { attributes: true, attributeFilter: ["style"] });
      (element as any)._timeObserver = observer;

      updateTimeLabels(event, element);
      setLabelsVisible(element, true);
    },
    [setLabelsVisible, updateTimeLabels],
  );

  const handleDragStop = useCallback(
    (info: any) => {
      setIsInternalDragging(false);
      const element = info.el;

      // Clean up observer
      const observer = (element as any)._timeObserver as MutationObserver | undefined;
      if (observer) {
        observer.disconnect();
        delete (element as any)._timeObserver;
      }

      setLabelsVisible(element, false);
    },
    [setLabelsVisible],
  );

  const handleResizeStart = useCallback(
    (info: any) => {
      setIsInternalDragging(true);
      const element = info.el;
      const event = info.event;
      if (event.allDay) return;

      // Start observing for style changes during resize
      const observer = new MutationObserver(() => updateTimeLabels(event, element));
      observer.observe(element, { attributes: true, attributeFilter: ["style"] });
      (element as any)._timeObserver = observer;

      updateTimeLabels(event, element);
      setLabelsVisible(element, true);
    },
    [setLabelsVisible, updateTimeLabels],
  );

  const handleResizeStop = useCallback(
    (info: any) => {
      const element = info.el;

      // Clean up observer
      const observer = (element as any)._timeObserver as MutationObserver | undefined;
      if (observer) {
        observer.disconnect();
        delete (element as any)._timeObserver;
      }

      setLabelsVisible(element, false);
    },
    [setLabelsVisible],
  );

  const handleSelect = useCallback(
    async (selection: DateSelectArg) => {
      if (!onCreateSelection) return;

      const start = selection.start ?? new Date();
      const end = selection.end ?? new Date(start.getTime() + 30 * 60000);

      try {
        await onCreateSelection(start, end);
      } catch (error) {
        logger.error('[Calendar] Error creating event:', error);
      } finally {
        calendarRef.current?.getApi()?.unselect();
      }
    },
    [onCreateSelection],
  );

  // External file drop handling
  const extractFilePathFromDrag = useCallback((e: React.DragEvent): string | null => {
    // Helper to parse obsidian:// URLs
    const parseObsidianUrl = (url: string): string | null => {
      try {
        // Match obsidian://open?vault=...&file=... or obsidian://vault/...
        const fileMatch = url.match(/[?&]file=([^&]+)/);
        if (fileMatch) {
          const filePath = decodeURIComponent(fileMatch[1]);
          // Add .md extension if not present
          return filePath.endsWith('.md') ? filePath : `${filePath}.md`;
        }
      } catch (err) {
        // ignore
      }
      return null;
    };

    // Try text/plain first
    const textData = e.dataTransfer.getData("text/plain");

    if (textData) {
      // Check if it's an obsidian:// URL
      if (textData.startsWith('obsidian://')) {
        const parsed = parseObsidianUrl(textData);
        if (parsed) {
          return parsed;
        }
      }

      // Could be a direct file path
      const cleaned = textData.trim();
      if (cleaned.endsWith(".md")) {
        return cleaned;
      }
    }

    // Try text/uri-list
    const uriData = e.dataTransfer.getData("text/uri-list");
    if (uriData && uriData.startsWith('obsidian://')) {
      const parsed = parseObsidianUrl(uriData);
      if (parsed) {
        return parsed;
      }
    }

    // Check for files in the dataTransfer
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith(".md")) {
        return (file as any).path || file.name;
      }
    }

    return null;
  }, []);

  const getDateFromDropEvent = useCallback((e: React.DragEvent): { date: Date; allDay: boolean } | null => {
    const api = calendarRef.current?.getApi();
    if (!api) {
      return null;
    }

    const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);

    if (!elementAtPoint) return null;

    let dateStr: string | null = null;
    let timeStr: string | null = null;
    let isAllDay = false;

    // First, get the time from the slot (if in time grid view)
    const slotLane = elementAtPoint.closest('.fc-timegrid-slot-lane');
    const slot = elementAtPoint.closest('.fc-timegrid-slot');

    if (slot) {
      timeStr = slot.getAttribute('data-time');
    }

    // For time grid view, we need to find the column date based on x position
    const timeGridBody = elementAtPoint.closest('.fc-timegrid-body');
    if (timeGridBody) {
      // Get all day columns
      const cols = timeGridBody.querySelectorAll('.fc-timegrid-col[data-date]');
      const dropX = e.clientX;

      // Find which column we're in based on x position
      for (const col of Array.from(cols)) {
        const rect = col.getBoundingClientRect();
        if (dropX >= rect.left && dropX <= rect.right) {
          dateStr = col.getAttribute('data-date');
          break;
        }
      }
    }

    // Check for day grid cell (month view)
    if (!dateStr) {
      const dayGridCell = elementAtPoint.closest('.fc-daygrid-day');
      if (dayGridCell) {
        dateStr = dayGridCell.getAttribute('data-date');
        if (dateStr) {
          isAllDay = true;
        }
      }
    }

    // Check for column header click
    if (!dateStr) {
      const colHeader = elementAtPoint.closest('[data-date]');
      if (colHeader) {
        dateStr = colHeader.getAttribute('data-date');
        if (dateStr) {
          // found date
        }
      }
    }

    if (!dateStr) {
      return null;
    }

    const date = new Date(dateStr + 'T00:00:00');

    if (timeStr) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      date.setHours(hours, minutes, 0, 0);
      isAllDay = false;
    } else if (!isAllDay) {
      // Default to 9 AM if no time found and not all-day
      date.setHours(9, 0, 0, 0);
    }

    // Resolved drop date
    return { date, allDay: isAllDay };
  }, []);

  const handleExternalDragOver = useCallback((e: React.DragEvent) => {
    // Check if this looks like a file drag
    const hasFiles = e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('text/plain');

    if (hasFiles && onExternalDrop) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [onExternalDrop]);

  const handleExternalDragEnter = useCallback((e: React.DragEvent) => {
    dragCounterRef.current++;
    const hasFiles = e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('text/plain');

    if (hasFiles && onExternalDrop) {
      e.preventDefault();
      setIsDraggingOver(true);
    }
  }, [onExternalDrop]);

  const handleExternalDragLeave = useCallback((e: React.DragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleExternalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    if (!onExternalDrop) return;

    const filePath = extractFilePathFromDrag(e);
    if (!filePath) {
      return;
    }

    const dropInfo = getDateFromDropEvent(e);
    if (!dropInfo) {
      return;
    }

    // External drop

    try {
      await onExternalDrop(filePath, dropInfo.date, dropInfo.allDay);
    } catch (error) {
      logger.error('[Calendar] Error handling external drop:', error);
    }
  }, [onExternalDrop, extractFilePathFromDrag, getDateFromDropEvent]);



  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(arg.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(arg.end);
    end.setHours(0, 0, 0, 0);

    // Check if today is within the visible range
    // Note: arg.end is exclusive
    const isVisible = today >= start && today < end;
    setIsTodayVisible(isVisible);
    setHeaderTitle(arg.view?.title ?? "");
  }, [onDateChange]);

  const handleHiddenTimeToggle = useCallback(() => {
    setHiddenTimeVisible((value) => !value);
  }, []);

  const handleToggleFullDay = useCallback(() => {
    if (onToggleFullDay) {
      onToggleFullDay();
      return;
    }
    setLocalShowFullDay((value) => !value);
  }, [onToggleFullDay]);

  const handleTodayCentered = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (viewMode === "month" || viewMode === "week") {
      api.today();
      if (onDateChange) onDateChange(api.getDate());
      return;
    }
    const offset = Math.floor((targetDayCount - 1) / 2);
    const target = new Date();
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() - offset);
    api.gotoDate(target);
    if (onDateChange) onDateChange(target);
  }, [targetDayCount, viewMode, onDateChange]);

  const handlePrevClick = useCallback(() => {
    if (viewMode === 'continuous') {
      if (continuousContainerRef.current) {
        // Scroll up by one day height (approx 800px or calculate)
        const currentScroll = continuousContainerRef.current.scrollTop;
        continuousContainerRef.current.scrollTo({ top: currentScroll - 800, behavior: 'smooth' });
        // Also update state if needed, but scroll listener handles data loading
      }
      return;
    }

    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (viewMode === "month") {
      api.prev();
      if (onDateChange) onDateChange(api.getDate());
      return;
    }
    const apiDate = api.getDate();
    const newDate = new Date(apiDate);
    newDate.setDate(newDate.getDate() - resolvedNavDays);
    api.gotoDate(newDate);
    if (onDateChange) onDateChange(newDate);
  }, [resolvedNavDays, viewMode, onDateChange]);

  // Date Picker Logic
  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleDateJump = useCallback(() => {
    if (dateInputRef.current) {
      // Pre-fill with current view date
      const api = calendarRef.current?.getApi();
      if (api) {
        const currentDate = api.getDate();
        // Format YYYY-MM-DD
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        dateInputRef.current.value = `${year}-${month}-${day}`;
      }

      // Open picker
      if (typeof (dateInputRef.current as any).showPicker === 'function') {
        (dateInputRef.current as any).showPicker();
      } else {
        dateInputRef.current.click();
      }
    }
  }, []);

  const handleDateInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;

    const targetDate = new Date(val + 'T00:00:00');
    // T00:00:00 is crucial to prevent timezone shift if treating as UTC, 
    // but Date(string) behavior varies. 
    // Safe approach: parse parts
    const [y, m, d] = val.split('-').map(Number);
    const safeDate = new Date(y, m - 1, d);

    if (calendarRef.current) {
      calendarRef.current.getApi().gotoDate(safeDate);
      if (onDateChange) onDateChange(safeDate);
    }
  }, [onDateChange]);

  const handleNextClick = useCallback(() => {
    if (viewMode === 'continuous') {
      if (continuousContainerRef.current) {
        const currentScroll = continuousContainerRef.current.scrollTop;
        continuousContainerRef.current.scrollTo({ top: currentScroll + 800, behavior: 'smooth' });
      }
      return;
    }

    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (viewMode === "month") {
      api.next();
      if (onDateChange) onDateChange(api.getDate());
      return;
    }
    const apiDate = api.getDate();
    const newDate = new Date(apiDate);
    newDate.setDate(newDate.getDate() + resolvedNavDays);
    api.gotoDate(newDate);
    if (onDateChange) onDateChange(newDate);
  }, [resolvedNavDays, viewMode, onDateChange]);

  // Touch swipe handlers for mobile navigation - DISABLED
  // Swipe navigation disabled to prevent conflicts with scrolling and event interaction
  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Disabled - navigation now only via buttons
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // Disabled - navigation now only via buttons
  }, []);

  // Touch listeners disabled - navigation via buttons only
  useEffect(() => {
    // Swipe navigation disabled on mobile
    // Users must use prev/next buttons to navigate
  }, []);

  // Hide mobile nav while scrolling/dragging to reduce clutter
  useEffect(() => {
    if (!isMobile) return;

    const container = containerRef.current;
    if (!container) return;

    const scrollers = Array.from(
      container.querySelectorAll<HTMLElement>('.fc-scroller, .fc-timegrid-body')
    );

    let showTimer: number | undefined;
    const hideNav = () => {
      setIsMobileNavHidden(true);
      if (showTimer) window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => setIsMobileNavHidden(false), 200);
    };

    scrollers.forEach((el) => {
      el.addEventListener('scroll', hideNav, { passive: true });
      el.addEventListener('wheel', hideNav, { passive: true });
      el.addEventListener('touchmove', hideNav, { passive: true });
    });

    return () => {
      if (showTimer) window.clearTimeout(showTimer);
      scrollers.forEach((el) => {
        el.removeEventListener('scroll', hideNav);
        el.removeEventListener('wheel', hideNav);
        el.removeEventListener('touchmove', hideNav);
      });
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    if (isInternalDragging) {
      setIsMobileNavHidden(true);
    } else {
      setIsMobileNavHidden(false);
    }
  }, [isMobile, isInternalDragging]);

  const handleCondenseChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (onCondenseLevelChange) {
      onCondenseLevelChange(Number(e.target.value));
    }
  }, [onCondenseLevelChange]);

  const sanitizedProperties = properties ?? [];

  const hasNonEmptyValue = useCallback((value: Value): boolean => {
    if (!value || !value.isTruthy()) return false;
    const str = value.toString();
    return !!str && str.trim().length > 0;
  }, []);

  const [isMini, setIsMini] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsMini(entry.contentRect.width < 550);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const renderEventContent = useCallback(
    (eventInfo: EventContentArg) => {
      // Basic data extraction
      const props = eventInfo.event.extendedProps;
      const title = eventInfo.event.title || props.calEntryTitle || 'Untitled';
      const entryPath = props.entryPath;

      // Attempt to retrieve the entry from our Map using the path
      const entry = entryPath ? basesEntryMap.get(entryPath) : undefined;

      // Property rendering logic
      const propertyChips = [];
      if (entry && sanitizedProperties && sanitizedProperties.length > 0) {
        for (const prop of sanitizedProperties) {
          try {
            // We need tryGetValue but it might not be imported or available in this scope directly if I didn't verify imports
            const value = tryGetValue(entry, prop);
            if (value && hasNonEmptyValue(value)) {
              propertyChips.push(
                <PropertyValue
                  key={prop}
                  value={value}
                  app={app}
                />
              );
            }
          } catch (err) {
            // console.warn('[Calendar] Error rendering property:', prop, err);
          }
        }
      }

      return (
        <div
          className="bases-calendar-event-content tps-calendar-entry"
          data-path={entryPath}
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          <div className="bases-calendar-event-title" style={{ fontWeight: 'bold', marginBottom: '2px' }}>{title}</div>

          {/* Render Properties as Chips */}
          {propertyChips.length > 0 && (
            <div className="bases-calendar-event-properties" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', overflow: 'hidden' }}>
              {propertyChips}
            </div>
          )}

        </div>
      );
    },
    [app, sanitizedProperties, hasNonEmptyValue, basesEntryMap],
  );

  const views = {
    "timeGridRange-3": {
      type: "timeGrid",
      duration: { days: 3 },
      buttonText: "3d",
    },
    "timeGridRange-5": {
      type: "timeGrid",
      duration: { days: 5 },
      buttonText: "5d",
    },
    "timeGridRange-7": {
      type: "timeGrid",
      duration: { days: 7 },
      buttonText: "7d",
    },
    timeGridWeek: {
      buttonText: "Week",
    },
    timeGridDay: {
      buttonText: "Day",
    },
    dayGridMonth: {
      buttonText: "Month",
    },
  };

  // Render navigation into portal if target is available
  const renderNavigation = () => {
    if (!showNavButtons || !headerPortalTarget) return null;

    const titleText = headerTitle; // Use the state variable for the title

    return createPortal(
      <div
        className="tps-calendar-header-nav"
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginLeft: '4px',
          height: '100%'
        }}
      >
        <div className="bases-calendar-nav-group" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {/* Calendar Picker (Far Left) */}
          <div style={{ position: 'relative', display: 'flex', marginRight: '2px' }}>
            <button
              className="bases-calendar-nav-button"
              aria-label="Jump to date"
              title="Jump to date"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                borderRadius: '4px',
                // On mobile, let the input handle the tap
                pointerEvents: isMobile ? 'none' : 'auto'
              }}
              onClick={(e) => {
                e.stopPropagation();
                const wrapper = e.currentTarget.parentElement;
                const input = wrapper?.querySelector('input');
                if (input) {
                  try {
                    if (currentDate) {
                      const d = new Date(currentDate);
                      const year = d.getFullYear();
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      input.value = `${year}-${month}-${day}`;
                    } else {
                      input.valueAsDate = new Date();
                    }
                    if (typeof (input as any).showPicker === 'function') {
                      (input as any).showPicker();
                    } else {
                      input.focus();
                      input.click();
                    }
                  } catch (err) {
                    input.focus();
                    input.click();
                  }
                }
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            </button>
            {/* Date input - on mobile it's tappable directly, on desktop the button triggers showPicker */}
            <input
              type="date"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '24px',
                height: '24px',
                opacity: 0,
                // On mobile, allow direct tap; on desktop, the button's onClick handles it
                zIndex: isMobile ? 10 : -1,
                pointerEvents: isMobile ? 'auto' : 'none',
                cursor: 'pointer'
              }}
              tabIndex={-1}
              onClick={(e) => {
                // Pre-fill with current date when tapped on mobile
                if (isMobile && currentDate) {
                  const d = new Date(currentDate);
                  const year = d.getFullYear();
                  const month = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  e.currentTarget.value = `${year}-${month}-${day}`;
                }
              }}
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  if (onDateChange) onDateChange(new Date(y, m - 1, d));
                }
              }}
            />
          </div>

          <button
            className="bases-calendar-nav-button"
            onClick={handlePrevClick}
            aria-label="Previous"
            title="Previous"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              borderRadius: '4px',
              fontSize: '18px',
              lineHeight: '1'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            ‹
          </button>

          <button
            className="bases-calendar-nav-button"
            onClick={handleTodayCentered}
            aria-label="Today"
            style={{
              background: 'transparent',
              border: '1px solid var(--background-modifier-border)',
              cursor: 'pointer',
              fontSize: '0.7rem',
              padding: '2px 8px',
              height: '24px',
              borderRadius: '4px',
              color: 'var(--text-normal)',
              margin: '0 2px'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Today
          </button>

          <button
            className="bases-calendar-nav-button"
            onClick={handleNextClick}
            aria-label="Next"
            title="Next"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              borderRadius: '4px',
              fontSize: '18px',
              lineHeight: '1'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            ›
          </button>
        </div>
      </div>,
      headerPortalTarget
    );
  };

  return (
    <div
      ref={containerRef}
      className={`bases-calendar-wrapper ${isDraggingOver ? 'is-drag-over' : ''} ${isMini ? 'bases-calendar-mini' : ''}`}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        "--calendar-slot-height": `${computedSlotHeight}px`,
        "--calendar-slot-zoom": `${zoom}`,
        position: "relative" // Ensure relative positioning for inner absolute if needed
      } as React.CSSProperties}
      onDragOver={handleExternalDragOver}
      onDragEnter={handleExternalDragEnter}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
    >
      {pendingChange && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "var(--background-primary)",
            border: "2px solid var(--background-modifier-border)",
            borderRadius: "8px",
            padding: "16px 24px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            zIndex: 1000,
            minWidth: "300px",
            textAlign: "center"
          }}
        >
          {/* ... pending change content ... */}
          <>
            <div style={{ marginBottom: "16px", fontSize: "14px", color: "var(--text-normal)" }}>
              Confirm event {pendingChange.type === 'drop' ? 'move' : 'resize'}?
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => confirmChangeWithScope("all")}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "var(--interactive-accent)",
                  color: "var(--text-on-accent)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "500"
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={handleCancelChange}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "var(--background-modifier-border)",
                  color: "var(--text-normal)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "500"
                }}
              >
                Cancel
              </button>
            </div>
          </>
        </div>
      )}

      {pendingChange && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 999
          }}
          onClick={handleCancelChange}
        />
      )}

      {renderNavigation()}

      <div style={{ flex: "1 1 0%", height: "100%", overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
        {viewMode !== 'continuous' && (
          <FullCalendar
            height={viewMode === "month" ? "auto" : "100%"}
            contentHeight={viewMode === "month" ? "auto" : "100%"}
            expandRows={viewMode !== "month"}
            plugins={PLUGINS}
            key={`calendar-${viewMode}-${resolvedShowFullDay}-${effectiveCondenseLevel}`}
            ref={calendarRef}
            initialView={viewName}
            initialDate={safeInitialDate}
            views={views}
            headerToolbar={false}
            selectable={!!onCreateSelection}
            selectMirror={true}
            selectOverlap={true}
            slotEventOverlap={false}
            select={handleSelect}
            selectLongPressDelay={300}
            longPressDelay={300}
            unselectAuto={true}
            unselectCancel=".fc-event"
            editable={editable}
            eventDurationEditable={!!onEventResize}
            events={events}
            eventContent={(info) => { return renderEventContent(info); }}
            eventClick={handleEventClick}
            eventMouseEnter={handleEventMouseEnter}
            eventMouseLeave={handleEventMouseLeave}
            eventDrop={handleDrop}
            eventResize={handleResize}
            eventDidMount={(arg) => { console.log('[FC-eventDidMount] called for:', arg.event.title); handleEventMount(arg); }}
            dayHeaderDidMount={handleDayMount}
            dayCellDidMount={handleDayMount}
            eventWillUnmount={handleEventWillUnmount}
            eventDragStart={handleDragStart}
            eventDragStop={handleDragStop}
            eventResizeStart={handleResizeStart}
            eventResizeStop={handleResizeStop}

            nowIndicator
            dayHeaderFormat={
              viewMode === "month"
                ? { weekday: "short" }
                : { weekday: "short", month: "short", day: "numeric" }
            }
            firstDay={safeWeekStartDay}
            slotMinTime={slotMinTimeValue}
            slotMaxTime={slotMaxTimeValue}
            scrollTime={DEFAULT_SCROLL_TIME}
            scrollTimeReset={false}
            slotDuration="00:30:00"
            snapDuration="00:05:00"
            slotLabelInterval="01:00"

            slotLabelFormat={{
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
              meridiem: 'short'
            }}
            allDaySlot={resolvedShowFullDay}
            displayEventTime={false}
            displayEventEnd={false}
            navLinks={true}
            navLinkDayClick={(date, jsEvent) => {
              if (onDateClick) onDateClick(date);
            }}
            datesSet={handleDatesSet}
            showNonCurrentDates={true}
            dayMaxEvents={true}
            fixedWeekCount={false}
            aspectRatio={isMini ? 1.6 : 1.1}
            handleWindowResize={true}
            windowResizeDelay={100}
          />

        )}

        {viewMode === 'continuous' && (
          <div
            ref={continuousContainerRef}
            className="bases-calendar-continuous-scroll-container"
            style={{
              height: '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: '1px', // Gap between days
              background: 'var(--background-secondary)'
            }}
            onScroll={handleContinuousScroll}
          >
            {continuousDays.map(day => (
              <div
                key={day.toISOString()}
                className="bases-calendar-continuous-day-block"
                style={{
                  minHeight: '800px', // Adjusted to ensure decent height
                  background: 'var(--background-primary)',
                  position: 'relative'
                }}
              >
                {/* Date Header */}
                <div style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  background: 'var(--background-primary)',
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--background-modifier-border)',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span
                    onClick={() => onDateClick && onDateClick(day)}
                    style={{ cursor: 'pointer', textDecoration: 'none' }}
                    className="fc-col-header-cell-cushion" // Use existing class for style reuse
                  >
                    {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  {day.toDateString() === new Date().toDateString() && (
                    <span style={{
                      fontSize: '0.8em',
                      color: 'var(--text-accent)',
                      background: 'rgba(var(--interactive-accent-rgb), 0.1)',
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>
                      Today
                    </span>
                  )}
                </div>

                <FullCalendar
                  key={`continuous-${day.toISOString()}`}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  initialView="timeGridDay"
                  initialDate={day}
                  headerToolbar={false}

                  // Layout props
                  height="auto" // Grow with content/slots
                  expandRows={true}
                  slotMinTime={slotMinTimeValue}
                  slotMaxTime={slotMaxTimeValue}
                  scrollTime={DEFAULT_SCROLL_TIME}
                  allDaySlot={resolvedShowFullDay}
                  slotDuration="00:30:00"
                  slotLabelInterval="01:00"

                  // Data props
                  events={events}
                  firstDay={safeWeekStartDay}
                  editable={editable}
                  selectable={editable}
                  selectMirror={true}

                  // Handlers (re-used from parent)
                  eventClick={handleEventClick}
                  eventContent={renderEventContent}
                  eventDrop={handleDrop}
                  eventResize={handleResize}
                  eventDidMount={handleEventMount}
                  eventWillUnmount={handleEventWillUnmount}
                  eventDragStart={handleDragStart}
                  eventDragStop={handleDragStop}
                  eventResizeStart={handleResizeStart}
                  eventResizeStop={handleResizeStop}
                  select={handleSelect}

                  // Visual settings
                  nowIndicator={day.toDateString() === new Date().toDateString()}
                  dayMaxEvents={false}
                  weekNumbers={false}
                  weekends={true}
                />
              </div>
            ))}
          </div>
        )}

        {/* Floating navigation (Mobile only fallback) */}
        {(isMobile && !headerPortalTarget && showNavButtons && !mobileNavHidden) && (
        <div className="bases-calendar-floating-nav" style={floatingNavStyle}>
            <div style={{ position: 'relative', display: 'flex' }}>
              <span
                className="bases-calendar-title-text"
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                  maxWidth: 'calc(100vw - 120px)',
                }}
                title="Jump to date"
              >
                {headerTitle}
                <span style={{ fontSize: '0.6em', opacity: 0.7 }}>▼</span>
              </span>

              {/* Date input overlay for mobile nav */}
              <input
                type="date"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  zIndex: 20, // Higher than nav container
                  pointerEvents: 'auto',
                  cursor: 'pointer'
                }}
                tabIndex={-1}
                onClick={(e) => {
                  // Pre-fill with current date when tapped
                  if (currentDate) {
                    const d = new Date(currentDate);
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    e.currentTarget.value = `${year}-${month}-${day}`;
                  }
                }}
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    if (onDateChange) onDateChange(new Date(y, m - 1, d));
                  }
                }}
              />
            </div>

            <div style={{ width: '1px', height: '16px', background: 'var(--background-modifier-border)', margin: '0 2px' }} />

            <button className="bases-calendar-nav-button" onClick={handlePrevClick} title="Previous">‹</button>
            <button className="bases-calendar-nav-button" onClick={handleTodayCentered} style={{ fontSize: '0.8rem', padding: '2px 8px' }}>Today</button>
            <button className="bases-calendar-nav-button" onClick={handleNextClick} title="Next">›</button>
          </div>
        )}
      </div>
    </div >
  );
};

const PropertyValue: React.FC<{ value: Value; app: any }> = ({ value, app }) => {
  const elementRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !app) return;
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }

      // Always use the Value's renderTo method for proper rendering
      if (value && typeof (value as any).renderTo === 'function') {
        value.renderTo(node, app.renderContext);
      }
    },
    [app, value],
  );

  return <span ref={elementRef} />;
};
