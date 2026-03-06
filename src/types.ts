export type Payload = Record<string, unknown>;
export type PayloadMode = "frontmatter" | "raw";

export interface PullRules {
	allowed_folder: string;
	allow_create: boolean;
	allow_modify: boolean;
	max_creates_per_cycle: number;
}

export interface BroadcastConfig {
	id: string;
	name: string;
	remote_url: string;
	api_token: string;
	query: string;
	payload_mode: PayloadMode;
	stripped_keys: string[];
	pull: boolean;
	pull_rules: PullRules;
	sync_log: boolean;
}

export interface SyncLogEntry {
	timestamp: string;
	action: "push" | "pull" | "delete" | "error";
	detail: string;
}

export interface CalendarModuleConfig {
	broadcast_id: string;
	event_folder: string;
	event_tag: string;
}

export interface ManifestEntry {
	note_path: string;
	content_hash: string;
	last_synced: string;
	ancestor: string | null;
}

export interface PullChange {
	id: string;
	payload: Record<string, unknown>;
	hash: string;
}

export interface SyncManifest {
	entries: Record<string, ManifestEntry>;
	last_full_sync: string | null;
}

export interface RelaySettings {
	broadcasts: BroadcastConfig[];
	calendar: CalendarModuleConfig;
}

export interface PluginData {
	settings: RelaySettings;
	manifests: Record<string, SyncManifest>;
}

export interface SyncDiff {
	create: string[];
	update: string[];
	delete: string[];
}
