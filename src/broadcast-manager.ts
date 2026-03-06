import { App, CachedMetadata, TAbstractFile, TFile } from "obsidian";
import { RelayAPI } from "./api";
import { SyncEngine } from "./sync";
import { BroadcastConfig, SyncManifest } from "./types";

export class BroadcastManager {
	private engines = new Map<string, { api: RelayAPI; engine: SyncEngine }>();

	constructor(
		private app: App,
		private broadcasts: BroadcastConfig[],
		private manifests: Record<string, SyncManifest>,
		private persistData: () => Promise<void>,
	) {}

	init(): void {
		for (const bc of this.broadcasts) {
			const manifest = this.manifests[bc.id] ??= { entries: {}, last_full_sync: null };
			const api = new RelayAPI(bc.remote_url, bc.api_token);
			const engine = new SyncEngine(this.app, api, manifest, bc, this.persistData);
			this.engines.set(bc.id, { api, engine });
		}
	}

	onMetadataChanged(file: TFile, data: string, cache: CachedMetadata): void {
		for (const { engine } of this.engines.values()) {
			engine.onMetadataChanged(file, data, cache);
		}
	}

	onFileDeleted(file: TAbstractFile): void {
		for (const { engine } of this.engines.values()) {
			engine.onFileDeleted(file);
		}
	}

	onFileRenamed(file: TAbstractFile, oldPath: string): void {
		for (const { engine } of this.engines.values()) {
			engine.onFileRenamed(file, oldPath);
		}
	}

	reconcileAll(): void {
		for (const { engine } of this.engines.values()) {
			engine.reconcile();
		}
	}

	rebuild(broadcasts: BroadcastConfig[]): void {
		this.destroyAll();
		this.broadcasts = broadcasts;
		this.init();
	}

	destroyAll(): void {
		for (const { engine } of this.engines.values()) {
			engine.destroy();
		}
		this.engines.clear();
	}

	getLastSync(broadcastId: string): string | null {
		return this.manifests[broadcastId]?.last_full_sync ?? null;
	}
}
