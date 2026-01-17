import ICAL from 'ical.js';

const log = (msg) => console.log(msg);

const testDate = (icalString, description) => {
    log(`--- ${description} ---`);
    log(`Input: ${icalString}`);
    try {
        const jcalData = ICAL.parse(icalString);
        const comp = new ICAL.Component(jcalData);
        const vevent = comp.getFirstSubcomponent('vevent');
        const event = new ICAL.Event(vevent);

        const start = event.startDate;
        log(`ICAL.Time: ${start.toString()}`);
        log(`Is Date (All Day): ${start.isDate}`);
        log(`Zone: ${start.zone.toString()}`);

        const jsDate = start.toJSDate();
        log(`JS Date (Local): ${jsDate.toString()}`);
        log(`JS Date (ISO): ${jsDate.toISOString()}`);
        log(`ICAL.Time.toString(): ${start.toString()}`);

        const dtstart = vevent.getFirstProperty('dtstart');
        if (dtstart) {
            log(`DTSTART TZID param: ${dtstart.getParameter('tzid')}`);
        }

    } catch (e) {
        log(`Error: ${e.message}`);
    }
    log('');
};

const floating = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20231027T100000
SUMMARY:Floating Event
END:VEVENT
END:VCALENDAR`;

const utc = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20231027T100000Z
SUMMARY:UTC Event
END:VEVENT
END:VCALENDAR`;

const tzid = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20231027T100000
SUMMARY:NY Event
END:VEVENT
END:VCALENDAR`;

const withVTimezone = `BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20231027T100000
SUMMARY:NY Event with VTIMEZONE
END:VEVENT
END:VCALENDAR`;

testDate(floating, 'Floating Time');
testDate(utc, 'UTC Time');
testDate(tzid, 'Time with TZID (No VTIMEZONE)');
testDate(withVTimezone, 'Time with TZID + VTIMEZONE');
