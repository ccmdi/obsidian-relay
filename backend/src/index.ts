import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { serve } from "@hono/node-server";
import { Store } from "./store.js";
import { generateICS } from "./ics.js";
import { dashboard } from "./dashboard.js";

const token = process.env["RELAY_API_TOKEN"];
if (!token) {
	console.error("RELAY_API_TOKEN is required");
	process.exit(1);
}

const caldavUser = process.env["RELAY_CALDAV_USER"] || "relay";
const icsDir = process.env["RELAY_ICS_DIR"] || `/app/radicale/data/collection-root/${caldavUser}/calendar`;
const dataDir = process.env["RELAY_DATA_DIR"] || "/app/data";
const port = parseInt(process.env["RELAY_PORT_API"] || "8080", 10);

const store = new Store(icsDir, dataDir);
const app = new Hono();

// Dashboard served without bearer auth
app.get("/", (c) => c.html(dashboard));

// API routes require bearer auth
app.use("/events/*", bearerAuth({ token }));
app.use("/sync", bearerAuth({ token }));

app.put("/events/:id", async (c) => {
	const id = c.req.param("id");
	const payload = await c.req.json<Record<string, unknown>>();
	const ics = generateICS(id, payload);
	const hash = computeHash(payload);
	const existed = store.has(id);

	store.put(id, ics, hash, payload);
	return c.json({ id, [existed ? "updated" : "created"]: true });
});

app.delete("/events/:id", (c) => {
	const id = c.req.param("id");
	if (!store.delete(id)) return c.json({ error: "not found" }, 404);
	return c.json({ id, deleted: true });
});

app.get("/events", (c) => {
	return c.json({ events: store.getAll() });
});

app.post("/sync", async (c) => {
	const body = await c.req.json<{ events: Record<string, string> }>();
	const clientEvents = body.events;
	const serverHashes = store.getHashes();

	const create: string[] = [];
	const update: string[] = [];
	const del: string[] = [];

	for (const [id, hash] of Object.entries(clientEvents)) {
		if (!(id in serverHashes)) create.push(id);
		else if (serverHashes[id] !== hash) update.push(id);
	}

	for (const id of Object.keys(serverHashes)) {
		if (!(id in clientEvents)) del.push(id);
	}

	return c.json({ create, update, delete: del });
});

function sortKeys(_key: string, value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[k] = (value as Record<string, unknown>)[k];
		}
		return sorted;
	}
	return value;
}

function computeHash(payload: Record<string, unknown>): string {
	const str = JSON.stringify(payload, sortKeys);
	return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

serve({ fetch: app.fetch, port }, () => {
	console.log(`Relay API listening on :${port}`);
});
