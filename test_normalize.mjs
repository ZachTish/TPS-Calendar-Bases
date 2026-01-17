import ICAL from 'ical.js';
import { moment } from 'obsidian';

const log = (msg) => console.log(msg);

log('=== Testing normalizeTime logic ===\n');

// Check if moment-timezone is available
log('Checking moment capabilities:');
log(`  moment exists: ${typeof moment !== 'undefined'}`);
log(`  moment.tz exists: ${typeof (moment as any).tz !== 'undefined'}`);

if (typeof (moment as any).tz !== 'undefined') {
    log(`  moment.tz.zone exists: ${typeof (moment as any).tz.zone === 'function'}`);

    // Test if we can get a specific zone
    const zone = (moment as any).tz.zone('America/Chicago');
    log(`  Can get America/Chicago zone: ${zone !== null}`);
    if (zone) {
        log(`    Zone name: ${zone.name}`);
    }

    // Test the actual normalization
    log('\nTesting timezone conversion:');
    const isoString = '2023-10-27T08:15:00';
    const targetTzid = 'America/Chicago';

    try {
        const m = (moment as any).tz(isoString, targetTzid);
        log(`  Input: ${isoString} in ${targetTzid}`);
        log(`  Result: ${m.format()}`);
        log(`  JS Date: ${m.toDate().toString()}`);
        log(`  ISO: ${m.toDate().toISOString()}`);
    } catch (e) {
        log(`  Error: ${e.message}`);
    }
} else {
    log('  moment-timezone is NOT available!');
    log('  This means the normalizeTime function will fall back to toJSDate()');
    log('  which will incorrectly interpret floating times as local time.');
}
