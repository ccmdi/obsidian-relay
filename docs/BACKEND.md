# Backend API

Relay pushes note data to any HTTP server that implements this contract. The included backend (`backend/`) is a reference implementation. You can replace it with anything.

## Authentication

Every request carries a bearer token:

```
Authorization: Bearer <your-token>
```

Return `401` for missing or invalid tokens.

## Endpoints

### `PUT /events/:id`

Create or update a note. Called whenever a matching note changes.

**Frontmatter mode** — `Content-Type: application/json`

```json
{
  "name": "My Note",
  "status": "active"
}
```

**Raw mode** — `Content-Type: text/markdown`

```
Body is the full file content (frontmatter + markdown).
```

In both cases, the optional header `X-Note-Path` contains the vault-relative path of the source note (e.g. `Projects/my-note.md`).

Response: any `2xx`.

---

### `DELETE /events/:id`

Delete a note that no longer matches the broadcast query (or was deleted from the vault).

Response: any `2xx`. Return `404` if the ID is not found.

---

### `POST /sync`

Bulk reconciliation. Called on startup and every 30 seconds. The plugin sends all known IDs and their content hashes; the server responds with what needs to change.

Request:

```json
{
  "events": {
    "<id>": "<content-hash>",
    "<id>": "<content-hash>"
  }
}
```

Response:

```json
{
  "create": ["<id>"],
  "update": ["<id>"],
  "delete": ["<id>"]
}
```

- `create` — IDs the server has never seen; the plugin will `PUT` them.
- `update` — IDs where the hash differs; the plugin will `PUT` them.
- `delete` — IDs on the server that no longer exist locally; the plugin will `DELETE` them.

The simplest correct implementation: store a map of `id → hash`. Compare against the incoming map and return the diff.

---

### `POST /pull` *(optional)*

Only required if pull mode is enabled on a broadcast. Returns changes the server has that the client should apply locally.

Request:

```json
{
  "entries": {
    "<id>": "<content-hash>"
  }
}
```

Response:

```json
{
  "changes": [
    {
      "id": "<id>",
      "payload": { "name": "My Note", "status": "active" },
      "hash": "<content-hash>"
    }
  ]
}
```

Only return entries that differ from the hash the client sent (or that the client doesn't have at all). The plugin handles 3-way merging and write guards.

## Content hash

The plugin computes hashes as the first 16 hex characters of SHA-256 over the JSON-serialized payload with keys sorted alphabetically. Your server can use any stable hash — the plugin treats it as an opaque string and only checks equality.
