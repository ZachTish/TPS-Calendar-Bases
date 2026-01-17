import ICAL from 'ical.js';

const log = (msg) => console.log(msg);

// Test the actual format from iCal files
const testICalString = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event-1
DTSTART;TZID=Central Standard Time:20231027T081500
DTEND;TZID=Central Standard Time:20231027T091500
SUMMARY:Test Event in Central Time
DESCRIPTION:This should be 8:15 AM Central Time
END:VEVENT
END:VCALENDAR`;

log('=== Testing iCal datetime parsing ===\n');

try {
    const jcalData = ICAL.parse(testICalString);
    const comp = new ICAL.Component(jcalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent);

    // Get DTSTART property
    const dtstartProp = vevent.getFirstProperty('dtstart');

    log('DTSTART property analysis:');
    log(`  Raw iCal string: ${dtstartProp.toICALString()}`);
    log(`  TZID parameter: ${dtstartProp.getParameter('tzid')}`);
    log(`  First value type: ${typeof dtstartProp.getFirstValue()}`);

    const rawValue = dtstartProp.getFirstValue();
    if (rawValue && typeof rawValue === 'object') {
        log(`  Raw value components:`)
        log(`    year: ${rawValue.year}, month: ${rawValue.month}, day: ${rawValue.day}`);
        log(`    hour: ${rawValue.hour}, minute: ${rawValue.minute}, second: ${rawValue.second}`);
        log(`    isDate: ${rawValue.isDate}`);
        log(`    zone: ${rawValue.zone}`);
        log(`    zone toString: ${rawValue.zone.toString()}`);
        log(`    toString(): ${rawValue.toString()}`);
        log(`    toJSDate(): ${rawValue.toJSDate()}`);
        log(`    toJSDate() ISO: ${rawValue.toJSDate().toISOString()}`);
    }

    log('\nEvent.startDate analysis:');
    log(`  toString(): ${event.startDate.toString()}`);
    log(`  zone: ${event.startDate.zone.toString()}`);
    log(`  isDate: ${event.startDate.isDate}`);
    log(`  toJSDate(): ${event.startDate.toJSDate()}`);
    log(`  toJSDate() ISO: ${event.startDate.toJSDate().toISOString()}`);

    log('\n=== The Problem ===');
    log('The TZID says "Central Standard Time" meaning 8:15 AM Central.');
    log('But ical.js zone is "floating", so toJSDate() treats it as LOCAL time.');
    log(`Since we're in Central timezone, 8:15 becomes 8:15 CDT = 13:15 UTC.`);
    log(`It should be 8:15 CST = 14:15 UTC (or 8:15 CDT = 13:15 UTC in summer).`);
    log('But the actual value in the DTSTART is 8:15 in the specified timezone,');
    log('not 8:15 in the local timezone.');

} catch (e) {
    log(`Error: ${e.message}`);
    log(e.stack);
}
