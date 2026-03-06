import { CachedMetadata, Plugin, TAbstractFile, TFile } from "obsidian";
import { EventModal } from "./calendar/event-modal";
import { BroadcastManager } from "./broadcast-manager";
import { EventSource } from "./calendar/event-source";
import { CalendarWeekView, CALENDAR_VIEW_TYPE } from "./calendar/week-view";
import { DEFAULT_SETTINGS, DEFAULT_PULL_RULES } from "./settings";
import { RelaySettingTab } from "./settings";
import { extractFirstTag } from "./query";
import { initSyncLog, loadSyncLogs } from "./sync";
import { PluginData, RelaySettings, SyncManifest } from "./types";

export default class RelayPlugin extends Plugin {
	settings: RelaySettings = DEFAULT_SETTINGS;
	private manifests: Record<string, SyncManifest> = {};
	private broadcastManager!: BroadcastManager;
	eventSource!: EventSource;

	async onload() {
		await this.loadPluginData();

		initSyncLog(this.manifest.dir!, this.app.vault.adapter);
		await loadSyncLogs();

		this.broadcastManager = new BroadcastManager(
			this.app,
			this.settings.broadcasts,
			this.manifests,
			() => this.savePluginData(),
		);
		this.broadcastManager.init();

		const calQuery = this.getCalendarBroadcastQuery();
		this.settings.calendar.event_tag = extractFirstTag(calQuery) ?? "event";
		this.eventSource = new EventSource(this.app, calQuery);

		this.registerView(CALENDAR_VIEW_TYPE, (leaf) =>
			new CalendarWeekView(leaf, this.eventSource, this.settings.calendar),
		);

		this.addSettingTab(new RelaySettingTab(this.app, this));

		this.addRibbonIcon("calendar", "Relay Calendar", () => {
			this.activateCalendarView();
		});

		this.addCommand({
			id: "relay-sync-now",
			name: "Sync all broadcasts",
			callback: () => this.broadcastManager.reconcileAll(),
		});

		this.addCommand({
			id: "relay-open-calendar",
			name: "Open calendar",
			callback: () => this.activateCalendarView(),
		});

		this.addCommand({
			id: "relay-new-event",
			name: "New event",
			callback: () => {
				const now = new Date();
				now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
				const end = new Date(now.getTime() + 3600000);
				new EventModal(this.app, {
					folder: this.settings.calendar.event_folder,
					eventTag: this.settings.calendar.event_tag,
					start: now,
					end,
				}).open();
			},
		});

		this.addCommand({
			id: "relay-focus-today",
			name: "Focus today",
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
				for (const leaf of leaves) {
					const view = leaf.view as CalendarWeekView;
					view?.goToday();
				}
			},
		});

		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile, data: string, cache: CachedMetadata) => {
				this.broadcastManager.onMetadataChanged(file, data, cache);
				this.eventSource.onFileChanged(file);
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				this.broadcastManager.onFileDeleted(file);
				this.eventSource.onFileDeleted(file);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				this.broadcastManager.onFileRenamed(file, oldPath);
				this.eventSource.onFileRenamed(file, oldPath);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.broadcastManager.reconcileAll();
			this.eventSource.loadAll();
		});

		this.registerInterval(window.setInterval(() => {
			this.broadcastManager.reconcileAll();
		}, 30000));
	}

	onunload() {
		this.broadcastManager?.destroyAll();
	}

	private getCalendarBroadcastQuery(): string {
		const bc = this.settings.broadcasts.find(b => b.id === this.settings.calendar.broadcast_id);
		return bc?.query ?? "";
	}

	rebuild(): void {
		this.broadcastManager.rebuild(this.settings.broadcasts);
		const query = this.getCalendarBroadcastQuery();
		this.eventSource.updateQuery(query);
		this.settings.calendar.event_tag = extractFirstTag(query) ?? "event";
	}

	getLastSync(broadcastId: string): string | null {
		const iso = this.broadcastManager.getLastSync(broadcastId);
		if (!iso) return null;
		return formatRelative(iso);
	}

	async loadPluginData(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
		this.manifests = data?.manifests ?? {};

		for (const bc of this.settings.broadcasts) {
			if (!bc.pull_rules) {
				bc.pull_rules = { ...DEFAULT_PULL_RULES };
			}
			if (bc.sync_log === undefined) {
				bc.sync_log = true;
			}
		}
	}

	async savePluginData(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			manifests: this.manifests,
		};
		await this.saveData(data);
	}

	private async activateCalendarView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}
}

function formatRelative(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}
