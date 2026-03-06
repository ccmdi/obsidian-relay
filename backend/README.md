# Relay CalDAV Backend

Receives frontmatter payloads from the Relay Obsidian plugin and serves them as calendar events over CalDAV.

## Setup

```bash
cp .env.example .env   # edit with real values
docker compose up --build
```

This starts:
- REST API on `:8080` (plugin pushes here)
- Radicale CalDAV on `:5232` (phone subscribes here)

## Expected Frontmatter Schema

Notes synced by the plugin must have frontmatter matching this structure. The backend uses these fields to generate `.ics` calendar entries.

```yaml
---
tags:
  - obj/calendar/event
name: "Dentist Appointment"
interval:
  start: 2026-03-15T10:00:00-05:00
  end: 2026-03-15T11:00:00-05:00
all_day: false
location: "123 Main St"
description: "Cleaning and checkup"
recurrence: null
reminders:
  - 30m
  - 10m
status: confirmed
---
```

### Field Reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | No | Defaults to empty if omitted. Maps to `SUMMARY`. |
| `interval.start` | ISO 8601 datetime | **Yes** | Must include timezone offset or `Z`. Maps to `DTSTART`. |
| `interval.end` | ISO 8601 datetime | **Yes** | Must include timezone offset or `Z`. Maps to `DTEND`. |
| `all_day` | boolean | No | When `true`, uses date-only values (`2026-03-15`). Defaults to `false`. |
| `location` | string | No | Free text. Maps to `LOCATION`. |
| `description` | string | No | Free text. Maps to `DESCRIPTION`. |
| `recurrence` | string or null | No | RRULE per RFC 5545 (e.g. `FREQ=WEEKLY;BYDAY=MO`). Maps to `RRULE`. |
| `reminders` | list of durations | No | Offset before start. Supports `m` (minutes), `h` (hours), `d` (days). Each becomes a `VALARM`. |
| `status` | enum | No | `confirmed`, `tentative`, or `cancelled`. Defaults to `confirmed`. Maps to `STATUS`. |

`relay_id` and `tags` are stripped by the plugin before sending and are not part of this schema.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `RELAY_API_TOKEN` | Bearer token for the REST API | (required) |
| `RELAY_CALDAV_USER` | CalDAV username | `relay` |
| `RELAY_CALDAV_PASS` | CalDAV password | (required) |
| `RELAY_PORT_API` | REST API port | `8080` |
| `RELAY_PORT_CALDAV` | Radicale port | `5232` |

## API Endpoints

All require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `PUT` | `/events/:id` | Create or update an event |
| `DELETE` | `/events/:id` | Delete an event |
| `GET` | `/events` | List all event IDs |
| `POST` | `/sync` | Bulk reconciliation (client sends `{ events: { id: hash } }`) |
