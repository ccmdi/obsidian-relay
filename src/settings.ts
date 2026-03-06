import { App, Modal, PluginSettingTab, Setting } from "obsidian";
import type RelayPlugin from "./main";
import { BroadcastConfig, PullRules, RelaySettings } from "./types";
import { syncLogs } from "./sync";
import { validateQuery } from "./query";

export const DEFAULT_PULL_RULES: PullRules = {
	allowed_folder: "",
	allow_create: true,
	allow_modify: true,
	max_creates_per_cycle: 20,
};

export const DEFAULT_SETTINGS: RelaySettings = {
	broadcasts: [],
	calendar: { broadcast_id: "", event_folder: "Calendar", event_tag: "event" },
};

export class RelaySettingTab extends PluginSettingTab {
	plugin: RelayPlugin;

	constructor(app: App, plugin: RelayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderBroadcasts(containerEl);
		this.renderCalendarModule(containerEl);
	}

	private renderBroadcasts(root: HTMLElement): void {
		const heading = new Setting(root).setName("Broadcasts").setHeading();
		heading.addButton(btn => btn
			.setButtonText("Add")
			.setCta()
			.onClick(async () => {
				this.plugin.settings.broadcasts.push({
					id: crypto.randomUUID(),
					name: `Broadcast ${this.plugin.settings.broadcasts.length + 1}`,
					remote_url: "",
					api_token: "",
					query: "",
					payload_mode: "frontmatter",
					stripped_keys: ["relay_id", "tags"],
					pull: false,
					pull_rules: { ...DEFAULT_PULL_RULES },
					sync_log: true,
				});
				await this.save();
				this.display();
			}));

		for (const bc of this.plugin.settings.broadcasts) {
			this.renderBroadcast(root, bc);
		}
	}

	private renderBroadcast(root: HTMLElement, bc: BroadcastConfig): void {
		new Setting(root).setName(bc.name).setHeading()
			.addButton(btn => btn
				.setButtonText("Delete")
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.broadcasts = this.plugin.settings.broadcasts.filter(b => b.id !== bc.id);
					if (this.plugin.settings.calendar.broadcast_id === bc.id) {
						this.plugin.settings.calendar.broadcast_id = "";
					}
					await this.save();
					this.display();
				}));

		const lastSync = this.plugin.getLastSync(bc.id);
		if (lastSync) {
			root.createDiv({ cls: "setting-item-description relay-last-synced", text: `Last synced: ${lastSync}` });
		}

		new Setting(root)
			.setName("Name")
			.addText(text => text
				.setValue(bc.name)
				.onChange(async (v) => {
					bc.name = v;
					await this.save();
				}));

		new Setting(root)
			.setName("Remote URL")
			.addText(text => text
				.setPlaceholder("https://example.com:8080")
				.setValue(bc.remote_url)
				.onChange(async (v) => { bc.remote_url = v; await this.save(); }));

		new Setting(root)
			.setName("API Token")
			.addText(text => {
				text.setPlaceholder("token")
					.setValue(bc.api_token)
					.onChange(async (v) => { bc.api_token = v; await this.save(); });
				text.inputEl.type = "password";
			});

		const querySetting = new Setting(root)
			.setName("Query")
			.setDesc("Which notes to broadcast. Examples: #tag, folder/*, #a or #b")
			.addText(text => text
				.setPlaceholder("#obj/calendar/event")
				.setValue(bc.query)
				.onChange(async (v) => {
					const result = validateQuery(v);
					if (result.valid) {
						text.inputEl.removeAttribute("aria-invalid");
						querySetting.descEl.setText("Which notes to broadcast. Examples: #tag, folder/*, #a or #b");
					} else {
						text.inputEl.setAttribute("aria-invalid", "true");
						querySetting.descEl.setText(result.error ?? "Invalid query");
					}
					bc.query = v;
					await this.save();
				}));

		new Setting(root)
			.setName("Payload mode")
			.setDesc("frontmatter: sync frontmatter JSON. raw: sync full file content.")
			.addDropdown(dd => dd
				.addOption("frontmatter", "Frontmatter")
				.addOption("raw", "Raw")
				.setValue(bc.payload_mode)
				.onChange(async (v) => {
					bc.payload_mode = v as "frontmatter" | "raw";
					await this.save();
					this.display();
				}));

		if (bc.payload_mode === "frontmatter") {
			new Setting(root)
				.setName("Stripped keys")
				.setDesc("Frontmatter keys to exclude from payload (comma-separated)")
				.addText(text => text
					.setValue(bc.stripped_keys.join(", "))
					.onChange(async (v) => {
						bc.stripped_keys = v.split(",").map(s => s.trim()).filter(Boolean);
						await this.save();
					}));
		}

		const pullSetting = new Setting(root)
			.setName("Pull")
			.setDesc(bc.pull && !bc.pull_rules.allowed_folder
				? "Set an allowed folder before pull can run"
				: "Pull remote changes into the vault (backend must support POST /pull)")
			.addToggle(toggle => toggle
				.setValue(bc.pull)
				.onChange(async (v) => {
					bc.pull = v;
					await this.save();
					this.display();
				}));

		if (bc.pull && !bc.pull_rules.allowed_folder) {
			pullSetting.descEl.style.color = "var(--text-error)";
		}

		if (bc.pull) {
			this.renderPullRules(root, bc);
		}

		const logSetting = new Setting(root)
			.setName("Sync log")
			.addToggle(toggle => toggle
				.setValue(bc.sync_log)
				.onChange(async (v) => {
					bc.sync_log = v;
					await this.save();
				}));
		if (bc.sync_log) {
			logSetting.addButton(btn => btn
				.setButtonText("View log")
				.onClick(() => new SyncLogModal(this.app, bc.id, bc.name).open()));
		}
	}

	private renderPullRules(root: HTMLElement, bc: BroadcastConfig): void {
		const rules = bc.pull_rules;

		new Setting(root)
			.setName("Allowed folder")
			.setDesc("All pulled files must be within this folder")
			.addText(text => text
				.setPlaceholder("Projects")
				.setValue(rules.allowed_folder)
				.onChange(async (v) => {
					rules.allowed_folder = v.trim();
					await this.save();
				}));

		new Setting(root)
			.setName("Allow new files")
			.setDesc("Let pull create files that only exist on the server")
			.addToggle(toggle => toggle
				.setValue(rules.allow_create)
				.onChange(async (v) => {
					rules.allow_create = v;
					await this.save();
				}));

		new Setting(root)
			.setName("Allow modifications")
			.setDesc("Let pull modify existing local files")
			.addToggle(toggle => toggle
				.setValue(rules.allow_modify)
				.onChange(async (v) => {
					rules.allow_modify = v;
					await this.save();
				}));

		new Setting(root)
			.setName("Max new files per sync")
			.setDesc("Cap on files created in a single pull cycle")
			.addText(text => text
				.setValue(String(rules.max_creates_per_cycle))
				.onChange(async (v) => {
					const n = parseInt(v, 10);
					if (!isNaN(n) && n >= 0) {
						rules.max_creates_per_cycle = n;
						await this.save();
					}
				}));
	}

	private renderCalendarModule(root: HTMLElement): void {
		new Setting(root).setName("Calendar module").setHeading();

		const broadcasts = this.plugin.settings.broadcasts;
		new Setting(root)
			.setName("Broadcast")
			.setDesc("Which broadcast the calendar reads events from")
			.addDropdown(dd => {
				dd.addOption("", "None");
				for (const bc of broadcasts) {
					dd.addOption(bc.id, bc.name);
				}
				dd.setValue(this.plugin.settings.calendar.broadcast_id);
				dd.onChange(async (v) => {
					this.plugin.settings.calendar.broadcast_id = v;
					await this.save();
				});
			});

		new Setting(root)
			.setName("Event folder")
			.setDesc("Folder where new events are created from the calendar")
			.addText(text => text
				.setPlaceholder("Calendar")
				.setValue(this.plugin.settings.calendar.event_folder)
				.onChange(async (v) => {
					this.plugin.settings.calendar.event_folder = v;
					await this.save();
				}));
	}

	private async save(): Promise<void> {
		await this.plugin.savePluginData();
		this.plugin.rebuild();
	}
}

class SyncLogModal extends Modal {
	private interval: number | null = null;
	private lastCount = -1;

	constructor(app: App, private broadcastId: string, private broadcastName: string) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`Sync log: ${this.broadcastName}`);
		this.render();
		this.interval = window.setInterval(() => this.render(), 2000);
	}

	private render(): void {
		const entries = syncLogs.get(this.broadcastId) ?? [];
		if (entries.length === this.lastCount) return;
		this.lastCount = entries.length;

		const { contentEl } = this;
		contentEl.empty();

		if (entries.length === 0) {
			contentEl.createEl("p", { text: "No log entries yet.", cls: "setting-item-description" });
			return;
		}

		const table = contentEl.createEl("table", { cls: "relay-sync-log-table" });
		const head = table.createEl("thead").createEl("tr");
		head.createEl("th", { text: "Time" });
		head.createEl("th", { text: "Action" });
		head.createEl("th", { text: "Detail" });

		const body = table.createEl("tbody");
		const visible = [...entries].reverse().slice(0, 100);
		for (const entry of visible) {
			const row = body.createEl("tr");
			const d = new Date(entry.timestamp);
			row.createEl("td", { text: d.toLocaleString() });
			row.createEl("td", { text: entry.action });
			row.createEl("td", { text: entry.detail });
		}
	}

	onClose(): void {
		if (this.interval !== null) window.clearInterval(this.interval);
		this.contentEl.empty();
	}
}
