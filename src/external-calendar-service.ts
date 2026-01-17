import ICAL from 'ical.js';
import { requestUrl, moment } from 'obsidian';
import * as logger from "./logger";

export interface ExternalCalendarEvent {
  id: string;
  uid: string; // Added UID
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  sourceUrl?: string;
  location?: string;
  organizer?: string;
  attendees?: string[];
  isAllDay: boolean;
  url?: string;
  isCancelled?: boolean;
}

export class ExternalCalendarService {
  private cache: Map<string, { events: ExternalCalendarEvent[]; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  public static warnedZones: Set<string> = new Set();

  async fetchEvents(
    calendarUrl: string,
    rangeStart?: Date,
    rangeEnd?: Date,
    includeCancelled: boolean = false
  ): Promise<ExternalCalendarEvent[]> {
    const normalizedUrl = this.normalizeUrl(calendarUrl);
    if (!normalizedUrl) {
      return [];
    }

    const cacheKey = this.getCacheKey(normalizedUrl, rangeStart, rangeEnd, includeCancelled);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.events;
    }

    try {
      const response = await requestUrl({
        url: normalizedUrl,
        method: 'GET',
        headers: {
          // Some calendar providers expect an explicit calendar Accept header
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
        },
      });

      if (response.status !== 200) {
        logger.error('[ExternalCalendar] Failed to fetch calendar:', response.status);
        return [];
      }

      const events = this.parseICalData(response.text, rangeStart, rangeEnd, includeCancelled).map((evt) => ({
        ...evt,
        sourceUrl: normalizedUrl,
      }));

      // Cache the results
      this.cache.set(cacheKey, {
        events,
        expiry: Date.now() + this.CACHE_TTL,
      });

      return events;
    } catch (error) {
      logger.error('[ExternalCalendar] Error fetching calendar:', error);
      return [];
    }
  }

  private parseICalData(
    icalData: string,
    rangeStart?: Date,
    rangeEnd?: Date,
    includeCancelled: boolean = false
  ): ExternalCalendarEvent[] {
    try {
      if (!icalData || typeof icalData !== 'string') {
        return [];
      }

      const trimmed = icalData.trim();
      if (!trimmed.toUpperCase().includes('BEGIN:VCALENDAR')) {
        return [];
      }

      const jcalData = ICAL.parse(icalData);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents('vevent');

      const events: ExternalCalendarEvent[] = [];
      const windowStart = rangeStart ? ICAL.Time.fromJSDate(rangeStart) : null;

      // Pass 1: Parse all events and index exceptions
      // We map UID -> Array of Recurrence-ID Times (ICAL.Time objects)
      // We use the native ICAL.Time object for comparison to handle timezones correctly
      const exceptions = new Map<string, ICAL.Time[]>();
      const parsedEvents: { event: ICAL.Event; vevent: ICAL.Component }[] = [];

      for (const vevent of vevents) {
        try {
          const event = new ICAL.Event(vevent);
          parsedEvents.push({ event, vevent });

          if (event.recurrenceId) {
            const uid = event.uid;
            if (!exceptions.has(uid)) {
              exceptions.set(uid, []);
            }
            exceptions.get(uid)?.push(event.recurrenceId);
          }
        } catch (e) {
          logger.warn('[ExternalCalendar] Error pre-parsing event:', e);
        }
      }

            // Pass 2: Process events
      for (const { event, vevent } of parsedEvents) {
        try {
          // Skip cancelled events (handle both spellings)
          const status = this.extractString(vevent, 'status', '').toUpperCase();
          const isCancelled = status === 'CANCELLED' || status === 'CANCELED';
          
          if (this.extractString(vevent, 'summary', '').toLowerCase().includes('jedi')) {
             logger.log(`[ExternalCalendar] Found 'Jedi' event. Status: ${status}, IsCancelled: ${isCancelled}, UID: ${this.extractString(vevent, 'uid', '')}`);
          }

          if (isCancelled && !includeCancelled) {
            continue;
          }

          const summary = this.extractString(vevent, 'summary', 'Untitled Event');
          const description = this.extractString(vevent, 'description', '');
          const location = this.extractString(vevent, 'location', '');
          const uid = this.extractString(vevent, 'uid', `${event.startDate.toUnixTime()}`);
          const url = this.extractString(vevent, 'url', '');

          const organizer = this.extractOrganizer(vevent);
          const attendees = this.extractAttendees(vevent);

          // Extract the TZID from the DTSTART property directly
          // This is our source of truth if ical.js fails to resolve the timezone
          const dtstartProp = vevent.getFirstProperty('dtstart');
          let explicitTzid: string | null = null;
          if (dtstartProp) {
            const tzidParam = dtstartProp.getParameter('tzid');
            if (typeof tzidParam === 'string') {
              explicitTzid = tzidParam.replace(/^["']|["']$/g, '');
            }

            // FORCE FLOATING logic (kept from original)
            if (explicitTzid) {
              const rawValue = dtstartProp.getFirstValue() as ICAL.Time;
              if (rawValue && rawValue.zone && rawValue.zone.toString() !== 'floating') {
                const floatingStart = new (ICAL.Time as any)({
                  year: rawValue.year,
                  month: rawValue.month,
                  day: rawValue.day,
                  hour: rawValue.hour,
                  minute: rawValue.minute,
                  second: rawValue.second,
                  isDate: rawValue.isDate
                });
                event.startDate = floatingStart;

                const dtendProp = vevent.getFirstProperty('dtend');
                if (dtendProp) {
                  const rawEndValue = dtendProp.getFirstValue() as ICAL.Time;
                  if (rawEndValue && rawEndValue.zone && rawEndValue.zone.toString() !== 'floating') {
                    const floatingEnd = new (ICAL.Time as any)({
                      year: rawEndValue.year,
                      month: rawEndValue.month,
                      day: rawEndValue.day,
                      hour: rawEndValue.hour,
                      minute: rawEndValue.minute,
                      second: rawEndValue.second,
                      isDate: rawEndValue.isDate
                    });
                    event.endDate = floatingEnd;
                  }
                }
              }
            }
          }

          if (event.isRecurring()) {
            const iterator = event.iterator(event.startDate);
            let next: ICAL.Time | null = null;
            let iterationCount = 0;
            const MAX_ITERATIONS = 2000;

            while ((next = iterator.next())) {
              iterationCount++;
              if (iterationCount > MAX_ITERATIONS) break;
              if (rangeEnd && next.compare(ICAL.Time.fromJSDate(rangeEnd)) > 0) break;

              // Check if this occurrence is overridden by an exception
              const eventUid = event.uid;
              if (exceptions.has(eventUid) && next) {
                const exceptionTimes = exceptions.get(eventUid);
                
                // Enhanced Exception Matching
                // We compare based on Time Value (seconds since epoch) to handle timezone differences correctly.
                // However, ical.js compare() should do this.
                // We add a fallback comparison for "Floating" vs "UTC" scenarios which might drift.
                
                const isException = exceptionTimes?.some(exTime => {
                    // 1. Standard strict comparison (handles TZ conversion)
                    if (exTime.compare(next!) === 0) return true;
                    
                    // 2. Loose comparison (ISO string match ignoring zone if one is floating)
                    // If one is floating and the other isn't, conversion might shift the time if not careful.
                    // But ical.js usually handles floating as "local".
                    
                    // 3. Fallback: Compare Unix Time explicitly
                    const t1 = exTime.toUnixTime();
                    const t2 = next!.toUnixTime();
                    if (Math.abs(t1 - t2) < 60) return true; // Match within 1 minute tolerance

                    // 4. Fallback: Component-wise comparison (Ignore Timezone)
                    // If the RECURRENCE-ID implies "1pm" and the occurrence is "1pm", we treat them as matched.
                    // This fixes issues where one is Floating and the other is Zoned.
                    if (
                        exTime.year === next!.year &&
                        exTime.month === next!.month &&
                        exTime.day === next!.day &&
                        exTime.hour === next!.hour &&
                        exTime.minute === next!.minute
                    ) {
                        return true;
                    }
                    
                    return false;
                });

                if (isException) {
                  // logger.log(`[ExternalCalendar] Skipping exception for ${event.summary} at ${next}`);
                  continue; // Skip this occurrence
                }
              }

              const occurrence = event.getOccurrenceDetails(next);

              const startDate = this.normalizeTime(occurrence.startDate, explicitTzid);
              const endDate = this.normalizeTime(occurrence.endDate, explicitTzid);

              this.pushEvent(
                events,
                startDate,
                endDate,
                occurrence.startDate.isDate,
                { uid, summary, description, location, organizer, attendees, url, isCancelled },
                rangeStart,
                rangeEnd
              );
            }
          } else {
            const end = event.endDate ?? event.startDate.clone();
            if (!event.endDate && event.duration) {
              end.addDuration(event.duration);
            }

            const startDate = this.normalizeTime(event.startDate, explicitTzid);
            const endDate = this.normalizeTime(end, explicitTzid);

            // STABLE ID GENERATION
            // For single events, use UID directly so hiding persists across rescheduling.
            // For exceptions, use UID + RecurrenceID (Original Time) which is also stable.
            let stableId: string | undefined;
            if (event.recurrenceId) {
                const rid = event.recurrenceId.toJSDate().getTime();
                stableId = `${uid}-${rid}`;
            } else {
                stableId = uid;
            }

            this.pushEvent(
              events,
              startDate,
              endDate,
              event.startDate.isDate,
              { uid, id: stableId, summary, description, location, organizer, attendees, url, isCancelled },
              rangeStart,
              rangeEnd
            );
          }
        } catch (innerError) {
          logger.warn('[ExternalCalendar] Error parsing single event:', innerError);
          continue;
        }
      }

      return events;
    } catch (error) {
      logger.error('[ExternalCalendar] Error parsing iCal data:', error);
      return [];
    }
  }

  // Mapping for common Windows/Outlook timezone names to IANA identifiers
  private readonly WINDOWS_TZ_MAPPING: Record<string, string> = {
    'Central Standard Time': 'America/Chicago',
    'Eastern Standard Time': 'America/New_York',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Mountain Standard Time': 'America/Denver',
    'India Standard Time': 'Asia/Kolkata',
    'China Standard Time': 'Asia/Shanghai',
    'Tokyo Standard Time': 'Asia/Tokyo',
    'GMT Standard Time': 'Europe/London',
    'Romance Standard Time': 'Europe/Paris',
    'W. Europe Standard Time': 'Europe/Berlin',
  };

  /**
   * Converts an ICAL.Time object to a native JavaScript Date object,
   * strictly enforcing the timezone if provided.
   */
  private normalizeTime(icalTime: ICAL.Time, explicitTzid: string | null): Date {
    // 1. All-day events are dates without times. ical.js handles these well as local dates.
    if (icalTime.isDate) {
      return icalTime.toJSDate();
    }

    // 2. If the time already has a proper timezone (not floating), use ical.js conversion
    if (icalTime.zone && icalTime.zone.toString() !== 'floating' && !explicitTzid) {
      return icalTime.toJSDate();
    }

    // 3. Resolve the timezone ID
    let targetTzid = explicitTzid;
    if (targetTzid && this.WINDOWS_TZ_MAPPING[targetTzid]) {
      targetTzid = this.WINDOWS_TZ_MAPPING[targetTzid];
    }

    // 4. If we have a valid target TZID and moment-timezone is available, use it.
    if (targetTzid && (moment as any).tz && (moment as any).tz.zone(targetTzid)) {
      // Construct ISO string manually to avoid any ical.js timezone logic
      // This ensures we take the "face value" of the time (e.g. 08:15) and assign the timezone
      // IMPORTANT: icalTime.month is 1-indexed (1=January, 12=December)
      const pad = (n: number) => String(n).padStart(2, '0');
      const isoString = `${icalTime.year}-${pad(icalTime.month)}-${pad(icalTime.day)}T${pad(icalTime.hour)}:${pad(icalTime.minute)}:${pad(icalTime.second)}`;

      const m = (moment as any).tz(isoString, targetTzid);

      if (m.isValid()) {
        return m.toDate();
      }

      if (!ExternalCalendarService.warnedZones.has(targetTzid)) {
        logger.warn('[ExternalCalendar] moment-timezone conversion failed', {
          isoString,
          targetTzid,
          fallback: 'using manual offset calculation'
        });
        ExternalCalendarService.warnedZones.add(targetTzid);
      }
    } else if (targetTzid) {
      if (!ExternalCalendarService.warnedZones.has(targetTzid)) {
        logger.warn('[ExternalCalendar] moment-timezone not available or zone not found', {
          targetTzid,
          momentTzAvailable: !!(moment as any).tz,
          zoneExists: (moment as any).tz ? !!(moment as any).tz.zone(targetTzid) : false
        });
        ExternalCalendarService.warnedZones.add(targetTzid);
      }
    }

    // 5. Fallback: Manual timezone offset calculation using Intl API
    // This handles cases where moment-timezone doesn't have the zone data
    if (targetTzid) {
      try {
        // Create a date string in the target timezone
        // We interpret the icalTime components as being in the target timezone
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${icalTime.year}-${pad(icalTime.month)}-${pad(icalTime.day)}T${pad(icalTime.hour)}:${pad(icalTime.minute)}:${pad(icalTime.second)}`;

        // Try to get the offset for this datetime in the target timezone
        // This uses the Intl API which should be available in all modern browsers
        const resolvedDate = this.parseDateInTimezone(dateStr, targetTzid);
        if (resolvedDate) {
          return resolvedDate;
        }
      } catch (error) {
        logger.warn('[ExternalCalendar] Manual timezone offset calculation failed', {
          targetTzid,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 6. Final fallback: Use ical.js's conversion.
    // Note: For floating times, this will interpret the time in the local timezone,
    // which may not be correct if explicitTzid was set.
    const fallbackResult = icalTime.toJSDate();
    return fallbackResult;
  }

  /**
   * Parse a date string as if it were in a specific timezone.
   * Uses the Intl API to determine the offset.
   */
  private parseDateInTimezone(dateStr: string, tzid: string): Date | null {
    try {
      // Parse the components from the date string
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
      if (!match) return null;

      const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const day = parseInt(dayStr);
      const hour = parseInt(hourStr);
      const minute = parseInt(minuteStr);
      const second = parseInt(secondStr);

      // We want to interpret these components as being in the target timezone
      // and convert to a UTC Date object.

      // Strategy: Create a date assuming it's in the target TZ, get its UTC string,
      // parse that to get the real UTC date

      // Best approach: Manually calculate using getTimezoneOffset equivalent for any TZ
      try {
        // Create a Date in UTC with our components
        const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

        // Format it in the target timezone to see what time it shows
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tzid,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        const parts = formatter.formatToParts(utcDate);
        const formatted: Record<string, string> = {};
        for (const part of parts) {
          if (part.type !== 'literal') {
            formatted[part.type] = part.value;
          }
        }

        // Now we know: when we have a UTC date with components (year, month, day, hour, minute, second),
        // it displays as (formatted.year, formatted.month, ...) in the target timezone.

        // We want the OPPOSITE: when the target  TZ shows (year, month, day, hour, minute, second),
        // what is the UTC time?

        // The offset is: (displayed_time) - (utc_time)
        // So: UTC_time = displayed_time - offset
        // And: offset = displayed_time - UTC_time

        const displayedMs = Date.UTC(
          parseInt(formatted.year),
          parseInt(formatted.month) - 1,
          parseInt(formatted.day),
          parseInt(formatted.hour),
          parseInt(formatted.minute),
          parseInt(formatted.second)
        );

        const utcMs = utcDate.getTime();
        const offset = displayedMs - utcMs;

        // Now, our desired components (year, month, day, hour, minute, second) should display in the target TZ
        // So the UTC time should be:
        const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second);
        const correctUTC = desiredMs - offset;

        return new Date(correctUTC);

      } catch (e) {
        // Intl API might not support the timezone
        logger.warn('[ExternalCalendar] Intl API does not support timezone:', tzid);
        return null;
      }

    } catch (error) {
      return null;
    }
  }

  private pushEvent(
    events: ExternalCalendarEvent[],
    startDate: Date,
    endDate: Date,
    isAllDay: boolean,
    props: {
      uid: string;
      id?: string; // Optional override
      summary: string;
      description: string;
      location: string;
      organizer: string;
      attendees: string[];
      url: string;
      isCancelled?: boolean;
    },
    rangeStart?: Date,
    rangeEnd?: Date
  ): void {
    // Filter by range
    if (rangeStart && startDate < rangeStart) return;
    if (rangeEnd && startDate > rangeEnd) return;

    events.push({
      id: props.id || `${props.uid}-${startDate.getTime()}`,
      uid: props.uid, // Populate UID
      title: props.summary,
      description: props.description,
      startDate,
      endDate,
      location: props.location,
      organizer: props.organizer,
      attendees: props.attendees,
      isAllDay,
      url: props.url,
      isCancelled: props.isCancelled,
    });
  }

  private extractString(vevent: ICAL.Component, propName: string, fallback: string): string {
    const val = vevent.getFirstPropertyValue(propName);
    if (val === null || val === undefined) return fallback;
    if (Array.isArray(val)) {
      return val.map(String).join(', ');
    }
    return String(val);
  }

  private extractOrganizer(vevent: ICAL.Component): string {
    const prop = vevent.getFirstProperty('organizer');
    if (!prop) return '';
    const cn = prop.getParameter('cn');
    const cnStr = Array.isArray(cn) ? cn[0] : cn;
    const val = prop.getFirstValue();
    const email = Array.isArray(val) ? String(val[0]) : (typeof val === 'string' ? val : String(val));
    return cnStr || email.replace('mailto:', '') || '';
  }

  private extractAttendees(vevent: ICAL.Component): string[] {
    const attendees: string[] = [];
    const props = vevent.getAllProperties('attendee');
    for (const prop of props) {
      const cn = prop.getParameter('cn');
      const cnStr = Array.isArray(cn) ? cn[0] : cn;
      const val = prop.getFirstValue();
      const email = Array.isArray(val) ? String(val[0]) : (typeof val === 'string' ? val : String(val));
      const attendee = cnStr || email.replace('mailto:', '') || '';
      if (attendee) attendees.push(attendee);
    }
    return attendees;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private normalizeUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase().startsWith('webcal://')) {
      return 'https://' + trimmed.slice('webcal://'.length);
    }
    return trimmed;
  }

  private getCacheKey(url: string, rangeStart?: Date, rangeEnd?: Date, includeCancelled?: boolean): string {
    const startKey = rangeStart ? rangeStart.toISOString().split('T')[0] : 'none';
    const endKey = rangeEnd ? rangeEnd.toISOString().split('T')[0] : 'none';
    return `${url}::${startKey}::${endKey}::${includeCancelled}`;
  }
}
