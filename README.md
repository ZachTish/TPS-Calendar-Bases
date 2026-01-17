# Weekly Calendar Bases

Adds a weekly time-grid calendar layout to Obsidian Bases, powered by FullCalendar, with optional external calendar (iCal) sync and meeting-note automation.

## Features

- New Bases view type: a weekly calendar (time-grid) layout.
- Styling controls for status/priority fields (colors, text styles, condense level).
- External calendar (iCal) support:
  - Subscribe to one or more iCal URLs.
  - Optional filter string and per-calendar color/tag configuration.
  - “Hide event” support (persists hidden IDs; also syncs hidden IDs from notes with `googleEventId` frontmatter).
- Meeting note automation:
  - Optional auto-create meeting notes from external events.
  - Configurable meeting note folder + template.
- Daily note embed syncing moved to the standalone `TPS Daily Embeds` plugin.

## How It Works (Technical)

- `src/main.ts` registers a Bases view via `registerBasesView`, using `CalendarView` as the view implementation.
- The calendar UI is FullCalendar-based (`@fullcalendar/*` packages) rendered through React.
- External calendars are fetched/parsed via `ical.js`; recurrence support is backed by `rrule`.
- Settings are persisted through Obsidian’s `loadData`/`saveData`, with compatibility parsing for older style-mapping keys.

## Key Files

- `src/main.ts`: plugin lifecycle, settings, commands, view registration.
- `src/calendar-view.tsx`: Bases calendar view implementation.
- `src/external-calendar-service.ts`: fetch/parse external events.
- `src/external-event-modal.ts`, `src/new-event-service.ts`: meeting note creation flow.
- `src/utils.ts`: style mapping + helpers.

## Development

- Install deps: `npm install`
- Dev build (watch): `npm run dev`
- Prod build: `npm run build`

## Troubleshooting

### Events Not Rendering
If note-based events are missing from the calendar:

1.  **Check Filter Logic**: Ensure `filters` in your view configuration allow the event. Note that `CalendarView` handles filters structurally; ensure you are not relying on name-based filtering for logical properties like `status`.
2.  **Check Hidden Statuses**: Global hidden statuses (under Plugin Settings) apply to calendar events (both lines and notes). However, if the View Configuration explicitly enables `showCompletedTasks`, events with `status: complete` (or `done`, `completed`) will override the global hidden setting and appear.

### Event Content Validation
The calendar uses a safe serialization approach for FullCalendar `extendedProps` to prevent circular reference errors. If you extend the event object, ensure you pass only primitive data (IDs, strings, booleans) in `extendedProps` and lookup the full `BasesEntry` object via `basesEntryMap` in local component state.
