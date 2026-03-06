import { App, Modal, TFile } from "obsidian";

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export interface EventModalOpts {
	filePath?: string;
	folder: string;
	eventTag: string;
	start: Date;
	end: Date;
	name?: string;
	location?: string;
	color?: string;
	recurrence?: string;
	onSaved?: () => Promise<void>;
}

export class EventModal extends Modal {
	private opts: EventModalOpts;
	private nameInput!: HTMLInputElement;
	private dateInput!: HTMLInputElement;
	private startInput!: HTMLInputElement;
	private endInput!: HTMLInputElement;
	private locationInput!: HTMLInputElement;
	private colorInput!: HTMLInputElement;
	private dayToggles!: HTMLElement[];
	private selectedDays!: Set<string>;

	private get editing(): boolean {
		return !!this.opts.filePath;
	}

	constructor(app: App, opts: EventModalOpts) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		this.titleEl.setText(this.editing ? "Edit Event" : "New Event");
		this.modalEl.addClass("relay-cal-modal");

		const form = this.contentEl.createDiv({ cls: "relay-cal-modal-form" });

		// name
		this.nameInput = this.field(form, "Name", "text", "Event name");
		this.nameInput.value = this.opts.name ?? "";
		this.nameInput.addClass("relay-cal-modal-name");

		// date + times row
		const timeRow = form.createDiv({ cls: "relay-cal-modal-row" });
		this.dateInput = this.field(timeRow, "Date", "date");
		this.dateInput.value = formatDateValue(this.opts.start);
		this.startInput = this.field(timeRow, "Start", "time");
		this.startInput.value = formatTimeValue(this.opts.start);
		this.endInput = this.field(timeRow, "End", "time");
		this.endInput.value = formatTimeValue(this.opts.end);

		// location
		this.locationInput = this.field(form, "Location", "text", "Optional");
		this.locationInput.value = this.opts.location ?? "";

		// color
		this.colorInput = this.field(form, "Color", "text", "#hex or name");
		this.colorInput.value = this.opts.color ?? "";

		// recurrence day toggles
		this.selectedDays = parseRecurrenceDays(this.opts.recurrence ?? "");
		const recField = form.createDiv({ cls: "relay-cal-modal-field" });
		recField.createEl("label", { text: "Repeat" });
		const strip = recField.createDiv({ cls: "relay-cal-day-toggles" });
		this.dayToggles = [];
		for (let i = 0; i < 7; i++) {
			const code = RRULE_DAYS[i]!;
			const btn = strip.createEl("button", {
				cls: `relay-cal-day-toggle${this.selectedDays.has(code) ? " is-active" : ""}`,
				text: DAY_LABELS[i],
			});
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				if (this.selectedDays.has(code)) {
					this.selectedDays.delete(code);
					btn.removeClass("is-active");
				} else {
					this.selectedDays.add(code);
					btn.addClass("is-active");
				}
			});
			this.dayToggles.push(btn);
		}

		// actions
		const actions = form.createDiv({ cls: "relay-cal-modal-actions" });
		actions.createDiv({ cls: "relay-cal-modal-spacer" });
		const save = actions.createEl("button", { cls: "mod-cta", text: "Save" });
		save.addEventListener("click", () => this.save());

		// enter to save
		this.contentEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.save();
			}
		});

		// focus name
		requestAnimationFrame(() => this.nameInput.focus());
	}

	private field(parent: HTMLElement, label: string, type: string, placeholder?: string): HTMLInputElement {
		const wrap = parent.createDiv({ cls: "relay-cal-modal-field" });
		wrap.createEl("label", { text: label });
		const input = wrap.createEl("input", { type });
		if (placeholder) input.placeholder = placeholder;
		return input;
	}

	private async save(): Promise<void> {
		const name = this.nameInput.value.trim();
		if (!name) {
			this.nameInput.addClass("relay-cal-modal-error");
			return;
		}

		const date = this.dateInput.value;
		const startTime = this.startInput.value;
		const endTime = this.endInput.value;
		const location = this.locationInput.value.trim();
		const color = this.colorInput.value.trim();
		const recurrence = buildRecurrenceRule(this.selectedDays);

		const start = parseDateAndTime(date, startTime);
		const end = parseDateAndTime(date, endTime);
		if (!start || !end) return;

		if (this.opts.onSaved) await this.opts.onSaved();
		if (this.editing) {
			await this.updateEvent(name, start, end, location, color, recurrence);
		} else {
			await this.createEvent(name, start, end, location, color, recurrence);
		}
		this.close();
	}

	private async createEvent(
		name: string, start: Date, end: Date,
		location: string, color: string, recurrence: string,
	): Promise<void> {
		await createEventNote(this.app, this.opts.folder, this.opts.eventTag, name, start, end, location, color, recurrence);
	}

	private async updateEvent(
		name: string, start: Date, end: Date,
		location: string, color: string, recurrence: string,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.opts.filePath!);
		if (!(file instanceof TFile)) return;

		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.name = name;
			if (!fm.interval) fm.interval = {};
			fm.interval.start = toLocalISO(start);
			fm.interval.end = toLocalISO(end);
			if (location) fm.location = location; else delete fm.location;
			if (color) fm.color = color; else delete fm.color;
			if (recurrence) fm.recurrence = recurrence; else delete fm.recurrence;
		});
	}

}

export function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatDateValue(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTimeValue(d: Date): string {
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDateAndTime(dateStr: string, timeStr: string): Date | null {
	const [y, m, d] = dateStr.split("-").map(Number);
	const [h, min] = timeStr.split(":").map(Number);
	if (y == null || m == null || d == null || h == null || min == null) return null;
	return new Date(y, m - 1, d, h, min, 0, 0);
}

function parseRecurrenceDays(rrule: string): Set<string> {
	const days = new Set<string>();
	if (!rrule) return days;
	if (rrule === "FREQ=DAILY") {
		for (const d of RRULE_DAYS) days.add(d);
		return days;
	}
	const match = rrule.match(/BYDAY=([A-Z,]+)/);
	if (match?.[1]) {
		for (const d of match[1].split(",")) days.add(d);
	}
	return days;
}

function buildRecurrenceRule(days: Set<string>): string {
	if (days.size === 0) return "";
	if (days.size === 7) return "FREQ=DAILY";
	const ordered = RRULE_DAYS.filter((d) => days.has(d));
	return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

export function toLocalISO(date: Date): string {
	const off = date.getTimezoneOffset();
	const sign = off <= 0 ? "+" : "-";
	const absOff = Math.abs(off);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`;
}

export async function createEventNote(
	app: App, folder: string, eventTag: string, name: string,
	start: Date, end: Date,
	location: string, color: string, recurrence: string,
): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(folder);
	if (!existing) await app.vault.createFolder(folder);

	const safeName = name.replace(/[\\/:*?"<>|]/g, "-");
	let path = `${folder}/${safeName}.md`;
	if (app.vault.getAbstractFileByPath(path)) {
		const dateTag = formatDateValue(start);
		path = `${folder}/${safeName} (${dateTag}).md`;
		let n = 1;
		while (app.vault.getAbstractFileByPath(path)) {
			path = `${folder}/${safeName} (${dateTag}) ${n}.md`;
			n++;
		}
	}

	const file = await app.vault.create(path, "");
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.tags = [eventTag];
		fm.name = name;
		fm.interval = { start: toLocalISO(start), end: toLocalISO(end) };
		if (location) fm.location = location;
		if (color) fm.color = color;
		if (recurrence) fm.recurrence = recurrence;
	});
}

export function addUntilToRrule(rrule: string, until: string): string {
	const parts = rrule.split(";").filter((p) => !p.startsWith("UNTIL="));
	parts.push(`UNTIL=${until}`);
	return parts.join(";");
}
