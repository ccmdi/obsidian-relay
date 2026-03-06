import { App, CachedMetadata, Notice, TAbstractFile, TFile } from "obsidian";
import { RelayAPI } from "./api";
import { merge3 } from "./merge";
import { fileMatchesQuery } from "./query";
import { BroadcastConfig, Payload, ManifestEntry, SyncLogEntry, SyncManifest } from "./types";

const MAX_LOG_ENTRIES = 200;
export const syncLogs = new Map<string, SyncLogEntry[]>();
let pluginDir = "";
let adapter: { read: (path: string) => Promise<string>; write: (path: string, data: string) => Promise<void> } | null = null;

const LOG_FILE = "sync-log.json";
function logPath(): string { return `${pluginDir}/${LOG_FILE}`; }

export function initSyncLog(dir: string, vaultAdapter: typeof adapter): void {
	pluginDir = dir;
	adapter = vaultAdapter;
}

export async function loadSyncLogs(): Promise<void> {
	if (!adapter) return;
	try {
		const raw = await adapter.read(logPath());
		const data = JSON.parse(raw) as Record<string, SyncLogEntry[]>;
		for (const [id, entries] of Object.entries(data)) {
			syncLogs.set(id, entries);
		}
	} catch { /* file doesn't exist yet */ }
}

async function persistLogs(): Promise<void> {
	if (!adapter) return;
	const obj: Record<string, SyncLogEntry[]> = {};
	for (const [id, entries] of syncLogs) obj[id] = entries;
	await adapter.write(logPath(), JSON.stringify(obj));
}

function addLog(broadcastId: string, enabled: boolean, action: SyncLogEntry["action"], detail: string): void {
	if (!enabled) return;
	let log = syncLogs.get(broadcastId);
	if (!log) { log = []; syncLogs.set(broadcastId, log); }
	log.push({ timestamp: new Date().toISOString(), action, detail });
	if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);
	persistLogs();
}

function extractPayload(fm: Record<string, unknown>, stripped: Set<string>): Payload {
	const payload: Payload = {};
	for (const [k, v] of Object.entries(fm)) {
		if (!stripped.has(k)) payload[k] = v;
	}
	return payload;
}

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

function serializePayload(payload: Payload): string {
	return JSON.stringify(payload, sortKeys, 2);
}

async function computeHash(payload: Payload): Promise<string> {
	return hashString(JSON.stringify(payload, sortKeys));
}

async function hashString(str: string): Promise<string> {
	const data = new TextEncoder().encode(str);
	const buf = await crypto.subtle.digest("SHA-256", data);
	const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
	return hex.slice(0, 16);
}

function sanitizePullPath(rawName: string, allowedFolder: string): string | null {
	const normalized = rawName.replace(/\\/g, "/");
	if (normalized.includes("..")) return null;
	if (normalized.startsWith(".obsidian/") || normalized.includes("/.obsidian/")) return null;

	// Strip any directory prefix -- only use the filename
	const basename = normalized.split("/").pop() ?? normalized;
	if (!basename) return null;

	const filename = basename.endsWith(".md") ? basename : `${basename}.md`;
	const folder = allowedFolder.replace(/\/$/, "");
	return folder ? `${folder}/${filename}` : filename;
}

function isWithinFolder(filePath: string, folder: string): boolean {
	if (!folder) return false;
	const normalized = filePath.replace(/\\/g, "/");
	const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/$/, "");
	return normalized.startsWith(normalizedFolder + "/");
}

export class SyncEngine {
	private processing = new Set<string>();
	private debounceTimers = new Map<string, number>();
	private strippedKeys: Set<string>;

	constructor(
		private app: App,
		private api: RelayAPI,
		public manifest: SyncManifest,
		private config: BroadcastConfig,
		private persistManifest: () => Promise<void>,
	) {
		this.strippedKeys = new Set(config.stripped_keys);
	}

	private isConfigured(): boolean {
		return !!(this.config.remote_url && this.config.api_token);
	}

	// --- Event handlers ---

	onMetadataChanged(file: TFile, _data: string, cache: CachedMetadata): void {
		if (!this.isConfigured()) return;
		this.debounce(file.path, () => this.handleChange(file, cache));
	}

	onFileDeleted(file: TAbstractFile): void {
		if (!this.isConfigured()) return;
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.handleDelete(file.path);
	}

	onFileRenamed(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		const entry = this.findEntryByPath(oldPath);
		if (!entry) return;
		entry[1].note_path = file.path;
		this.persistManifest();
	}

	// --- Core sync logic ---

	private async handleChange(file: TFile, cache: CachedMetadata): Promise<void> {
		if (this.processing.has(file.path)) return;
		this.processing.add(file.path);

		try {
			if (!fileMatchesQuery(this.app, file, this.config.query)) {
				const entry = this.findEntryByPath(file.path);
				if (entry) await this.syncDelete(entry[0]);
				return;
			}

			const fm = cache.frontmatter;
			if (!fm) {
				if (this.config.payload_mode === "frontmatter") return;
			}

			let relayId: string | undefined = fm?.relay_id;
			if (!relayId) {
				relayId = crypto.randomUUID();
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					frontmatter.relay_id = relayId;
				});
			}

			if (this.config.pull) return; // defer to reconcile for bidirectional sync

			const { payload, hash, serialized } = await this.buildPayload(file, fm);
			const existing = this.manifest.entries[relayId];
			if (existing && existing.content_hash === hash) return;

			await this.api.put(relayId, payload, file.path);
			addLog(this.config.id, this.config.sync_log, "push", file.path);

			this.manifest.entries[relayId] = {
				note_path: file.path,
				content_hash: hash,
				last_synced: new Date().toISOString(),
				ancestor: serialized,
			};
			await this.persistManifest();
		} catch (e) {
			console.error(`Relay [${this.config.name}]: sync failed for`, file.path, e);
			addLog(this.config.id, this.config.sync_log, "error", `push failed: ${file.path}`);
		} finally {
			this.processing.delete(file.path);
		}
	}

	private async buildPayload(
		file: TFile,
		fm: Record<string, unknown> | undefined,
	): Promise<{ payload: Payload | string; hash: string; serialized: string }> {
		if (this.config.payload_mode === "raw") {
			const content = await this.app.vault.read(file);
			return { payload: content, hash: await hashString(content), serialized: content };
		}
		const extracted = extractPayload(fm!, this.strippedKeys);
		const serialized = serializePayload(extracted);
		return { payload: extracted, hash: await computeHash(extracted), serialized };
	}

	private async handleDelete(path: string): Promise<void> {
		const entry = this.findEntryByPath(path);
		if (!entry) return;
		await this.syncDelete(entry[0]);
	}

	private async syncDelete(relayId: string): Promise<void> {
		try {
			await this.api.remove(relayId);
			addLog(this.config.id, this.config.sync_log, "delete", relayId);
		} catch (e) {
			console.error(`Relay [${this.config.name}]: delete failed for`, relayId, e);
			addLog(this.config.id, this.config.sync_log, "error", `delete failed: ${relayId}`);
		}
		delete this.manifest.entries[relayId];
		await this.persistManifest();
	}

	// --- Full reconciliation ---

	async reconcile(): Promise<void> {
		if (!this.isConfigured()) return;

		try {
			if (this.config.pull) await this.pull();
			await this.push();
		} catch (e) {
			console.error(`Relay [${this.config.name}]: reconciliation failed`, e);
			addLog(this.config.id, this.config.sync_log, "error", `reconciliation failed: ${e}`);
		}
	}

	private async push(): Promise<void> {
		const currentState = await this.buildCurrentState();

		const hashMap: Record<string, string> = {};
		for (const [id, { hash }] of currentState) {
			hashMap[id] = hash;
		}

		const diff = await this.api.sync(hashMap);

		const pushed = [...diff.create, ...diff.update];
		for (const id of pushed) {
			const state = currentState.get(id);
			if (!state) continue;
			await this.api.put(id, state.payload, state.path);
			addLog(this.config.id, this.config.sync_log, "push", state.path);
			this.manifest.entries[id] = {
				note_path: state.path,
				content_hash: state.hash,
				last_synced: new Date().toISOString(),
				ancestor: state.serialized,
			};
		}

		for (const id of diff.delete) {
			await this.api.remove(id);
			addLog(this.config.id, this.config.sync_log, "delete", id);
			delete this.manifest.entries[id];
		}

		for (const [id, entry] of Object.entries(this.manifest.entries)) {
			if (!currentState.has(id)) {
				delete this.manifest.entries[id];
			} else {
				const state = currentState.get(id);
				if (state) entry.note_path = state.path;
			}
		}

		this.manifest.last_full_sync = new Date().toISOString();
		await this.persistManifest();
	}

	private async pull(): Promise<void> {
		const rules = this.config.pull_rules;
		if (!rules.allowed_folder) {
			console.warn(`Relay [${this.config.name}]: pull skipped -- no allowed_folder configured`);
			return;
		}

		const hashMap: Record<string, string> = {};
		for (const [id, entry] of Object.entries(this.manifest.entries)) {
			hashMap[id] = entry.content_hash;
		}

		let changes;
		try {
			changes = await this.api.pull(hashMap);
		} catch (e) {
			console.error(`Relay [${this.config.name}]: pull failed`, e);
			addLog(this.config.id, this.config.sync_log, "error", `pull failed: ${e}`);
			return;
		}

		let created = 0, modified = 0, blocked = 0;

		for (const change of changes) {
			const remoteSerialized = this.config.payload_mode === "raw"
				? String(change.payload.content ?? "")
				: serializePayload(change.payload);
			const entry = this.manifest.entries[change.id];
			const localFile = entry
				? this.app.vault.getAbstractFileByPath(entry.note_path) as TFile | null
				: null;

			if (!localFile) {
				if (!rules.allow_create) { blocked++; continue; }
				if (created >= rules.max_creates_per_cycle) { blocked++; continue; }

				const rawName = this.config.payload_mode === "raw"
					? change.id
					: ((change.payload.name as string) ?? change.id);
				const safePath = sanitizePullPath(rawName, rules.allowed_folder);
				if (!safePath) {
					console.warn(`Relay [${this.config.name}]: blocked pull create -- invalid path "${rawName}"`);
					blocked++;
					continue;
				}

				await this.createFromPull(change.id, change.payload, remoteSerialized, change.hash, safePath);
				created++;
				continue;
			}

			if (!rules.allow_modify) { blocked++; continue; }
			if (!isWithinFolder(localFile.path, rules.allowed_folder)) {
				console.warn(`Relay [${this.config.name}]: blocked pull modify -- "${localFile.path}" outside allowed folder`);
				blocked++;
				continue;
			}

			const localSerialized = await this.readLocalSerialized(localFile);
			const ancestor = entry?.ancestor ?? "";

			let merged: string;
			if (!ancestor || ancestor === localSerialized) {
				merged = remoteSerialized;
			} else if (ancestor === remoteSerialized) {
				continue;
			} else {
				const result = merge3(ancestor, localSerialized, remoteSerialized);
				merged = result.result;
				if (result.conflicts) {
					console.warn(`Relay [${this.config.name}]: merge conflicts in ${entry!.note_path}`);
				}
			}

			await this.writeLocalMerged(localFile, merged);
			modified++;

			this.manifest.entries[change.id] = {
				note_path: localFile.path,
				content_hash: change.hash,
				last_synced: new Date().toISOString(),
				ancestor: remoteSerialized,
			};
		}

		if (created || modified || blocked) {
			const parts: string[] = [];
			if (created) parts.push(`${created} created`);
			if (modified) parts.push(`${modified} updated`);
			if (blocked) parts.push(`${blocked} blocked`);
			new Notice(`Relay [${this.config.name}] pull: ${parts.join(", ")}`);
			addLog(this.config.id, this.config.sync_log, "pull", parts.join(", "));
		}

		await this.persistManifest();
	}

	private async readLocalSerialized(file: TFile): Promise<string> {
		if (this.config.payload_mode === "raw") {
			return this.app.vault.read(file);
		}
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return "{}";
		return serializePayload(extractPayload(fm, this.strippedKeys));
	}

	private async writeLocalMerged(file: TFile, merged: string): Promise<void> {
		if (this.config.payload_mode === "raw") {
			await this.app.vault.modify(file, merged);
			return;
		}
		const parsed = JSON.parse(merged) as Record<string, unknown>;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			for (const key of Object.keys(fm)) {
				if (!this.strippedKeys.has(key) && !(key in parsed)) {
					delete fm[key];
				}
			}
			for (const [key, value] of Object.entries(parsed)) {
				fm[key] = value;
			}
		});
	}

	private async createFromPull(
		id: string, payload: Record<string, unknown>,
		serialized: string, hash: string, safePath: string,
	): Promise<void> {
		// Ensure parent folder exists
		const folder = safePath.substring(0, safePath.lastIndexOf("/"));
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		let content: string;
		if (this.config.payload_mode === "raw") {
			content = serialized;
		} else {
			const yamlLines = ["---"];
			yamlLines.push(`relay_id: ${id}`);
			for (const [k, v] of Object.entries(payload)) {
				yamlLines.push(`${k}: ${JSON.stringify(v)}`);
			}
			yamlLines.push("---", "");
			content = yamlLines.join("\n");
		}

		await this.app.vault.create(safePath, content);
		this.manifest.entries[id] = {
			note_path: safePath,
			content_hash: hash,
			last_synced: new Date().toISOString(),
			ancestor: serialized,
		};
	}

	// --- Build state ---

	private async buildCurrentState(): Promise<Map<string, { payload: Payload | string; hash: string; path: string; serialized: string }>> {
		const state = new Map<string, { payload: Payload | string; hash: string; path: string; serialized: string }>();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			if (!fileMatchesQuery(this.app, file, this.config.query)) continue;

			const fm = cache.frontmatter;
			if (!fm && this.config.payload_mode === "frontmatter") continue;

			let relayId: string | undefined = fm?.relay_id;
			if (!relayId) {
				relayId = crypto.randomUUID();
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					frontmatter.relay_id = relayId;
				});
			}

			const { payload, hash, serialized } = await this.buildPayload(file, fm);
			state.set(relayId, { payload, hash, path: file.path, serialized });
		}

		return state;
	}

	// --- Helpers ---

	private findEntryByPath(path: string): [string, ManifestEntry] | null {
		for (const [id, entry] of Object.entries(this.manifest.entries)) {
			if (entry.note_path === path) return [id, entry];
		}
		return null;
	}

	private debounce(filePath: string, fn: () => void, delay = 2000): void {
		const existing = this.debounceTimers.get(filePath);
		if (existing != null) window.clearTimeout(existing);
		this.debounceTimers.set(filePath, window.setTimeout(() => {
			this.debounceTimers.delete(filePath);
			fn();
		}, delay));
	}

	destroy(): void {
		for (const timer of this.debounceTimers.values()) {
			window.clearTimeout(timer);
		}
		this.debounceTimers.clear();
	}
}
