#!/usr/bin/env node
import ICAL from 'ical.js';

/**
 * This script demonstrates the iCal datetime parsing issue.
 * Run with: node debug_ical_full.mjs
 */

// Simulate the normalizeTime function from external-calendar-service.ts
// Note: We can't use moment-timezone here since we're not in Obsidian context
function normalizeTimeSimulated(icalTime, explicitTzid) {
    console.log(`\n  normalizeTime called with:`);
    console.log(`    icalTime: ${icalTime.toString()}`);
    console.log(`    icalTime.zone: ${icalTime.zone.toString()} `);
    console.log(`    explicitTzid: ${explicitTzid} `);

    if (icalTime.isDate) {
        console.log(`    -> All - day event, using toJSDate()`);
        return icalTime.toJSDate();
    }

    // This is what SHOULD happen in the code:
    // If we have explicitTzid, build ISO string and use moment.tz()
    // But without moment-timezone available, we fall back to toJSDate()

    console.log(`    -> Without moment - timezone, falling back to toJSDate()`);
    console.log(`    -> Result: ${icalTime.toJSDate()} (${icalTime.toJSDate().toISOString()})`);

    return icalTime.toJSDate();
}

const testEvent = `BEGIN: VCALENDAR
VERSION: 2.0
PRODID: -//Test//Test//EN
    BEGIN: VEVENT
UID: test - recurring - 1
DTSTART; TZID = Central Standard Time: 20231027T081500
DTEND; TZID = Central Standard Time: 20231027T091500
SUMMARY:Recurring Event in Central Time
RRULE: FREQ = WEEKLY; BYDAY = FR; COUNT = 3
END: VEVENT
END: VCALENDAR`;

console.log('=== Full iCal Parsing Flow ===\n');
console.log('Input iCal:\n', testEvent);

try {
    const jcalData = ICAL.parse(testEvent);
    const comp = new ICAL.Component(jcalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent);

    // Extract TZID from DTSTART property
    const dtstartProp = vevent.getFirstProperty('dtstart');
    let explicitTzid = null;
    if (dtstartProp) {
        const tzidParam = dtstartProp.getParameter('tzid');
        if (typeof tzidParam === 'string') {
            explicitTzid = tzidParam.replace(/^["']|["']$/g, '');
        }
    }

    console.log(`\nExtracted explicitTzid: "${explicitTzid}"`);
    console.log(`event.startDate.zone: ${event.startDate.zone.toString()} `);
    console.log(`event.isRecurring(): ${event.isRecurring()} `);

    // This is the code from lines 123-138 that forces floating
    if (explicitTzid) {
        const rawValue = dtstartProp.getFirstValue();
        if (rawValue) {
            console.log(`\nForcing floating time(lines 123 - 138): `);
            console.log(`  Raw value before: ${rawValue.toString()}, zone: ${rawValue.zone.toString()} `);

            const floatingStart = new ICAL.Time({
                year: rawValue.year,
                month: rawValue.month,
                day: rawValue.day,
                hour: rawValue.hour,
                minute: rawValue.minute,
                second: rawValue.second,
                isDate: rawValue.isDate
            });

            console.log(`  Floating time created: ${floatingStart.toString()}, zone: ${floatingStart.zone.toString()} `);

            // Update event's start date
            event.startDate = floatingStart;

            console.log(`  Event.startDate updated to: ${event.startDate.toString()}, zone: ${event.startDate.zone.toString()} `);
        }
    }

    // Now iterate through recurrences
    if (event.isRecurring()) {
        const iterator = event.iterator(event.startDate);
        let count = 0;
        let next;

        console.log(`\n === Iterating recurrences === `);
        while ((next = iterator.next()) && count < 3) {
            count++;
            console.log(`\nOccurrence #${count}: `);
            console.log(`  next: ${next.toString()}, zone: ${next.zone.toString()} `);

            const occurrence = event.getOccurrenceDetails(next);
            console.log(`  occurrence.startDate: ${occurrence.startDate.toString()}, zone: ${occurrence.startDate.zone.toString()} `);

            // This is where normalizeTime would be called (line 179)
            const normalized = normalizeTimeSimulated(occurrence.startDate, explicitTzid);
        }
    }

    console.log(`\n\n === SUMMARY === `);
    console.log(`The problem: When TZID is "Central Standard Time" but there's no VTIMEZONE,`);
    console.log(`ical.js creates floating times. The iterator produces floating occurrences.`);
    console.log(`When we call toJSDate() on a floating time, it interprets the time as LOCAL.`);
    console.log(`So 08:15 floating becomes 08:15 in whatever timezone NodeJS is running in.`);
    console.log(`\nThe fix should use moment-timezone to interpret "08:15" as "08:15 in Central Time".`);

} catch (e) {
    console.error('Error:', e);
    console.error(e.stack);
}
