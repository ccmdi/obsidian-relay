>![important] WIP
>This is a work in progress. The core API is stable but other things (including the name and module system) are likely to change.

# Relay

Obsidian plugin that syncs notes to a remote server via broadcasts.

## How it works

Each broadcast defines a query (e.g. `#tag`, `folder/*`) that selects which notes to sync. Matching notes are pushed to the configured remote URL.

## Sync types

| Trigger | Push-only | Pull enabled |
|---------|-----------|--------------|
| File save | 2s debounce | Deferred to reconcile |
| Reconcile cycle | Every 30s | Every 30s |
| Plugin startup | Once | Once |

## Payload modes

### Frontmatter

Extracts the note's YAML frontmatter and syncs it as JSON.

A note like this:

```yaml
---
relay_id: abc-123
name: My Note
status: active
tags: [project]
---
Some body content here.
```

Produces this payload:

```json
{
  "name": "My Note",
  "status": "active"
}
```

The `relay_id` is assigned automatically if missing. It uniquely identifies the note across syncs.

### Raw

Syncs the entire file content as-is (body + frontmatter).

## Pull rules

Pull broadcasts require an allowed folder. All pulled files are written within that folder.

| Rule | Description |
|------|-------------|
| Allowed folder | All pulled files must live here |
| Allow new files | Let pull create files that only exist on the server |
| Allow modifications | Let pull modify existing local files |
| Max new files per sync | Cap on files created in a single pull cycle |

## Building a backend

See [docs/BACKEND.md](docs/BACKEND.md) for the full API contract.

## Settings

Remote URL is the base URL of the relay server (e.g. `https://example.com/relay`). The plugin appends `/sync`, `/events/:id`, `/pull` automatically.

API Token is a Bearer token sent with every request.

Query controls which notes to broadcast (e.g. `#tag`, `folder/*`, `#a or #b`).

Sync log, when enabled, records push/pull/delete/error activity per broadcast. View it from the broadcast settings.
