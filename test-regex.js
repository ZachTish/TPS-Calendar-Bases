
const scheduleLine = "[x] meeting with jandi and work on 19500 [2026/01/07 10:05 AM - 11:25 AM]";
const NEW_FORMAT = /\[(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)\]/;
const match = scheduleLine.match(NEW_FORMAT);
console.log("Match:", match);
if (match) {
    const [, year, month, day, startHour, startMinute, startPeriod, endHour, endMinute, endPeriod] = match;
    console.log("Parsed:", { year, month, day, startHour, startMinute, startPeriod, endHour, endMinute, endPeriod });
}
