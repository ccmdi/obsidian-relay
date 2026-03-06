import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface IndexEntry {
	hash: string;
	payload: Record<string, unknown>;
}

export class Store {
	private indexPath: string;
	private index: Record<string, IndexEntry>;

	constructor(private icsDir: string, dataDir: string) {
		this.indexPath = join(dataDir, "relay-index.json");
		mkdirSync(icsDir, { recursive: true });
		mkdirSync(dataDir, { recursive: true });
		this.index = this.loadIndex();
	}

	has(id: string): boolean {
		return id in this.index;
	}

	put(id: string, icsContent: string, contentHash: string, payload: Record<string, unknown>): void {
		writeFileSync(join(this.icsDir, `${id}.ics`), icsContent);
		this.index[id] = { hash: contentHash, payload };
		this.saveIndex();
	}

	delete(id: string): boolean {
		const path = join(this.icsDir, `${id}.ics`);
		if (!existsSync(path)) return false;
		unlinkSync(path);
		delete this.index[id];
		this.saveIndex();
		return true;
	}

	getHashes(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [id, entry] of Object.entries(this.index)) {
			out[id] = entry.hash;
		}
		return out;
	}

	getAll(): Array<{ id: string; payload: Record<string, unknown> }> {
		return Object.entries(this.index).map(([id, entry]) => ({ id, payload: entry.payload }));
	}

	private loadIndex(): Record<string, IndexEntry> {
		if (!existsSync(this.indexPath)) return {};
		const raw = JSON.parse(readFileSync(this.indexPath, "utf-8"));
		// Handle old format (string values = hash only)
		const out: Record<string, IndexEntry> = {};
		for (const [id, val] of Object.entries(raw)) {
			if (typeof val === "string") {
				out[id] = { hash: val, payload: {} };
			} else {
				out[id] = val as IndexEntry;
			}
		}
		return out;
	}

	private saveIndex(): void {
		writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
	}
}
