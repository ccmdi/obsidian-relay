import { App, TAbstractFile, TFile } from "obsidian";
import { datetime, rrulestr } from "rrule";
import { fileMatchesQuery } from "../query";
import { CalendarEvent } from "./types";

export class EventSource {
	private events = new Map<string, CalendarEvent>();
	private exdates = new Map<string, Set<string>>();
	private ruleCache = new Map<string, { recStr: string; startMs: number; rule: ReturnType<typeof rrulestr> }>();
	private listeners: (() => void)[] = [];

	constructor(
		private app: App,
		private query: string,
	) {}

	onChange(fn: () => void): () => void {
		this.listeners.push(fn);
		return () => {
			const i = this.listeners.indexOf(fn);
			if (i !== -1) this.listeners.splice(i, 1);
		};
	}

	private notify(): void {
		for (const fn of this.listeners) fn();
	}

	loadAll(): void {
		this.events.clear();
		this.exdates.clear();
		this.ruleCache.clear();
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.processFile(file);
		}
		this.notify();
	}

	onFileChanged(file: TFile): void {
		if (!file.path.endsWith(".md")) return;
		const had = this.events.has(file.path);
		this.processFile(file);
		const has = this.events.has(file.path);
		if (had || has) this.notify();
	}

	onFileDeleted(file: TAbstractFile): void {
		this.exdates.delete(file.path);
		this.ruleCache.delete(file.path);
		if (this.events.delete(file.path)) this.notify();
	}

	onFileRenamed(file: TAbstractFile, oldPath: string): void {
		const event = this.events.get(oldPath);
		if (!event) return;
		this.events.delete(oldPath);
		const cached = this.ruleCache.get(oldPath);
		this.ruleCache.delete(oldPath);
		if (cached) this.ruleCache.set(file.path, cached);
		event.filePath = file.path;
		this.events.set(file.path, event);
		this.notify();
	}

	updateQuery(query: string): void {
		this.query = query;
		this.loadAll();
	}

	getEventsInRange(rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
		const result: CalendarEvent[] = [];
		const rangeStartMs = rangeStart.getTime();
		const rangeEndMs = rangeEnd.getTime();

		for (const event of this.events.values()) {
			if (event.recurrence) {
				result.push(...this.expandRecurrence(event, rangeStart, rangeEnd));
			} else if (event.end.getTime() > rangeStartMs && event.start.getTime() < rangeEndMs) {
				result.push(event);
			}
		}

		return result;
	}

	private processFile(file: TFile): void {
		if (!fileMatchesQuery(this.app, file, this.query)) {
			this.events.delete(file.path);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) {
			this.events.delete(file.path);
			return;
		}

		const event = this.parseEvent(file.path, cache.frontmatter);
		if (event) {
			this.events.set(file.path, event);
			const rawExdates = cache.frontmatter.exdates;
			if (Array.isArray(rawExdates) && rawExdates.length > 0) {
				this.exdates.set(file.path, new Set(rawExdates.map(String)));
			} else {
				this.exdates.delete(file.path);
			}
		} else {
			this.events.delete(file.path);
			this.exdates.delete(file.path);
			this.ruleCache.delete(file.path);
		}
	}

	private parseEvent(filePath: string, fm: Record<string, unknown>): CalendarEvent | null {
		const interval = fm.interval as { start?: string; end?: string } | undefined;
		if (!interval?.start) return null;

		const start = new Date(interval.start as string);
		if (isNaN(start.getTime())) return null;

		let end: Date;
		if (interval.end) {
			end = new Date(interval.end as string);
			if (isNaN(end.getTime())) end = new Date(start.getTime() + 3600000);
		} else {
			end = new Date(start.getTime() + 3600000);
		}

		return {
			filePath,
			name: (fm.name as string) ?? filePath.split("/").pop()?.replace(".md", "") ?? "Untitled",
			start,
			end,
			allDay: fm.all_day === true,
			color: (fm.color as string) ?? null,
			recurrence: (fm.recurrence as string) ?? null,
			sourceRecurrence: null,
		};
	}

	// rrule works in UTC internally, so we pass local times as "fake UTC"
	// and convert results back to local time
	private expandRecurrence(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
		try {
			const duration = event.end.getTime() - event.start.getTime();
			const s = event.start;

			const dtstart = datetime(
				s.getFullYear(), s.getMonth() + 1, s.getDate(),
				s.getHours(), s.getMinutes(), s.getSeconds(),
			);

			const cached = this.ruleCache.get(event.filePath);
			let rule;
			if (cached && cached.recStr === event.recurrence && cached.startMs === s.getTime()) {
				rule = cached.rule;
			} else {
				rule = rrulestr(`RRULE:${event.recurrence}`, { dtstart });
				this.ruleCache.set(event.filePath, { recStr: event.recurrence!, startMs: s.getTime(), rule });
			}

			const fakeStart = datetime(
				rangeStart.getFullYear(), rangeStart.getMonth() + 1, rangeStart.getDate(),
			);
			const fakeEnd = datetime(
				rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, rangeEnd.getDate(),
				rangeEnd.getHours(), rangeEnd.getMinutes(), rangeEnd.getSeconds(),
			);

			const occurrences = rule.between(fakeStart, fakeEnd, false);
			const excludedDates = this.exdates.get(event.filePath);

			return occurrences
				.filter((fakeUtc) => {
					if (!excludedDates || excludedDates.size === 0) return true;
					const y = fakeUtc.getUTCFullYear();
					const m = String(fakeUtc.getUTCMonth() + 1).padStart(2, "0");
					const d = String(fakeUtc.getUTCDate()).padStart(2, "0");
					return !excludedDates.has(`${y}-${m}-${d}`);
				})
				.map((fakeUtc) => {
					const localStart = new Date(
						fakeUtc.getUTCFullYear(), fakeUtc.getUTCMonth(), fakeUtc.getUTCDate(),
						fakeUtc.getUTCHours(), fakeUtc.getUTCMinutes(), fakeUtc.getUTCSeconds(),
					);
					return {
						...event,
						start: localStart,
						end: new Date(localStart.getTime() + duration),
						recurrence: null,
						sourceRecurrence: event.recurrence,
					};
				});
		} catch (e) {
			console.error("Relay: failed to expand recurrence for", event.filePath, e);
			return [];
		}
	}
}
