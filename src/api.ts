import { requestUrl } from "obsidian";
import { Payload, PullChange, SyncDiff } from "./types";

export class RelayAPI {
	constructor(private baseUrl: string, private token: string) {}

	private headers(contentType = "application/json"): Record<string, string> {
		return {
			"Authorization": `Bearer ${this.token}`,
			"Content-Type": contentType,
		};
	}

	async put(id: string, payload: Payload | string, notePath?: string): Promise<void> {
		const isRaw = typeof payload === "string";
		const headers = this.headers(isRaw ? "text/markdown" : "application/json");
		if (notePath) headers["X-Note-Path"] = notePath;
		await requestUrl({
			url: `${this.baseUrl}/events/${encodeURIComponent(id)}`,
			method: "PUT",
			headers,
			body: isRaw ? payload : JSON.stringify(payload),
		});
	}

	async remove(id: string): Promise<void> {
		await requestUrl({
			url: `${this.baseUrl}/events/${encodeURIComponent(id)}`,
			method: "DELETE",
			headers: this.headers(),
		});
	}

	async sync(entries: Record<string, string>): Promise<SyncDiff> {
		const response = await requestUrl({
			url: `${this.baseUrl}/sync`,
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ events: entries }),
		});
		return response.json as SyncDiff;
	}

	async pull(entries: Record<string, string>): Promise<PullChange[]> {
		const response = await requestUrl({
			url: `${this.baseUrl}/pull`,
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ entries }),
		});
		return (response.json as { changes: PullChange[] }).changes;
	}
}
