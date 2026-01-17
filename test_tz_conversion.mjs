#!/usr/bin/env node

/**
 * Test the timezone conversion logic
 */

// Simulate the parseDateInTimezone function
function parseDateInTimezone(dateStr, tzid) {
    try {
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
        if (!match) return null;

        const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        const day = parseInt(dayStr);
        const hour = parseInt(hourStr);
        const minute = parseInt(minuteStr);
        const second = parseInt(secondStr);

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
            const formatted = {};
            for (const part of parts) {
                if (part.type !== 'literal') {
                    formatted[part.type] = part.value;
                }
            }

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

            const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second);
            const correctUTC = desiredMs - offset;

            return new Date(correctUTC);

        } catch (e) {
            console.warn('Intl API does not support timezone:', tzid);
            return null;
        }

    } catch (error) {
        return null;
    }
}

// Test cases
console.log('=== Testing timezone conversion ===\n');

// Test 1: 08:15 in America/Chicago on Oct 27, 2023
const test1 = parseDateInTimezone('2023-10-27T08:15:00', 'America/Chicago');
console.log('Test 1: 08:15 in America/Chicago on 2023-10-27');
console.log('  Result:', test1?.toString());
console.log('  ISO:', test1?.toISOString());
console.log('  Expected: 2023-10-27T13:15:00.000Z (CDT, UTC-5)');
console.log('  Match:', test1?.toISOString() === '2023-10-27T13:15:00.000Z' ? '✓' : '✗');
console.log();

// Test 2: 14:00 in America/Chicago
const test2 = parseDateInTimezone('2023-12-03T14:00:00', 'America/Chicago');
console.log('Test 2: 14:00 in America/Chicago on 2023-12-03');
console.log('  Result:', test2?.toString());
console.log('  ISO:', test2?.toISOString());
console.log('  Expected: 2023-12-03T20:00:00.000Z (CST, UTC-6)');
console.log('  Match:', test2?.toISOString() === '2023-12-03T20:00:00.000Z' ? '✓' : '✗');
console.log();

// Test 3: 08:15 in America/New_York
const test3 = parseDateInTimezone('2023-10-27T08:15:00', 'America/New_York');
console.log('Test 3: 08:15 in America/New_York on 2023-10-27');
console.log('  Result:', test3?.toString());
console.log('  ISO:', test3?.toISOString());
console.log('  Expected: 2023-10-27T12:15:00.000Z (EDT, UTC-4)');
console.log('  Match:', test3?.toISOString() === '2023-10-27T12:15:00.000Z' ? '✓' : '✗');
