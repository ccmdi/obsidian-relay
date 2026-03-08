import { ItemView, Menu, Modal, TFile, WorkspaceLeaf } from "obsidian";
import { datetime, rrulestr } from "rrule";
import { CalendarModuleConfig } from "../types";
import {
	EventModal, EventModalOpts,
	createEventNote, addUntilToRrule, toLocalISO, formatDateValue, pad,
} from "./event-modal";
import { EventSource } from "./event-source";
import { layoutEvents } from "./layout";
import { askRecurrenceEdit } from "./recurrence-modal";
import { CalendarEvent, PositionedEvent } from "./types";

export const CALENDAR_VIEW_TYPE = "relay-calendar";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export class CalendarWeekView extends ItemView {
	private weekStart: Date;
	private eventSource: EventSource;
	private calendarConfig: CalendarModuleConfig;
	private nowInterval: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private lastKnownWidth = 0;
	private mobile = false;
	private mobileDay = new Date().getDay();
	private savedScroll: number | null = null;
	private firstRender = true;
	private dayColumns: { el: HTMLElement; day: Date }[] = [];
	private preventClick = false;
	private dragging = false;
	private unsubscribeEvents: (() => void) | null = null;
	private renderQueued = false;
	private optimistic = new Map<string, { start: Date; end: Date; ts: number }>();
	private deferredRender: number | null = null;
	private suppressUntil = 0;


	constructor(leaf: WorkspaceLeaf, eventSource: EventSource, calendarConfig: CalendarModuleConfig) {
		super(leaf);
		this.eventSource = eventSource;
		this.calendarConfig = calendarConfig;
		this.weekStart = weekStartOf(new Date());
	}

	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}
	getDisplayText(): string {
		return "Relay Calendar";
	}
	getIcon(): string {
		return "calendar";
	}

	async onOpen(): Promise<void> {
		this.firstRender = true;
		this.contentEl.empty();
		this.contentEl.addClass("relay-calendar");

		this.unsubscribeEvents = this.eventSource.onChange(() => this.requestRender());

		this.resizeObserver = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect?.width ?? 1000;
			const wasHidden = this.lastKnownWidth === 0;
			this.lastKnownWidth = width;
			const wasMobile = this.mobile;
			this.mobile = width < 500;
			if (wasMobile !== this.mobile) {
				this.render();
			} else if (wasHidden && width > 0) {
				this.scrollToSaved();
			}
		});
		this.resizeObserver.observe(this.contentEl);

		this.render();
		this.startNowLine();
	}

	async onClose(): Promise<void> {
		if (this.nowInterval != null) window.clearInterval(this.nowInterval);
		if (this.deferredRender != null) window.clearTimeout(this.deferredRender);
		this.unsubscribeEvents?.();
		this.resizeObserver?.disconnect();
	}

	// ---- rendering ----

	private render(): void {
		if (this.dragging) {
			this.renderQueued = true;
			return;
		}
		const el = this.contentEl;
		el.empty();
		el.toggleClass("is-mobile", this.mobile);

		this.renderHeader(el);
		if (this.mobile) {
			this.renderDay(el, this.mobileDay);
		} else {
			this.renderWeek(el);
		}
	}

	private renderHeader(root: HTMLElement): void {
		if (!this.mobile) return;

		const header = root.createDiv({ cls: "relay-cal-header" });
		const strip = header.createDiv({ cls: "relay-cal-day-strip" });

		this.navBtn(strip, "\u2039", -1, "relay-cal-strip-nav");

		for (let i = 0; i < 7; i++) {
			const d = this.dayAt(i);
			const b = this.btn(strip, `${DAYS[i]!}\n${d.getDate()}`, "relay-cal-day-chip", () => {
				this.mobileDay = i;
				this.render();
			});
			if (i === this.mobileDay) b.addClass("is-active");
			if (isToday(d)) b.addClass("is-today");
		}

		this.navBtn(strip, "\u203A", 1, "relay-cal-strip-nav");
	}

	private renderWeek(root: HTMLElement): void {
		const end = new Date(this.weekStart);
		end.setDate(end.getDate() + 7);

		const rawEvents = this.eventSource.getEventsInRange(this.weekStart, end);
		const events = this.applyOptimistic(rawEvents);
		const allDay: CalendarEvent[] = [];
		const timed: CalendarEvent[] = [];
		for (const e of events) (e.allDay ? allDay : timed).push(e);

		if (allDay.length) this.renderAllDayRow(root, allDay);

		// day header row
		const headers = root.createDiv({ cls: "relay-cal-day-headers" });
		headers.createDiv({ cls: "relay-cal-gutter" });
		for (let i = 0; i < 7; i++) {
			const d = this.dayAt(i);
			const h = headers.createDiv({ cls: "relay-cal-day-header" });
			h.createSpan({ cls: "relay-cal-day-name", text: DAYS[i] });
			h.createSpan({ cls: "relay-cal-day-num", text: String(d.getDate()) });
			if (isToday(d)) h.addClass("is-today");
		}

		// scrollable body with nav zones
		const body = root.createDiv({ cls: "relay-cal-body" });
		const inner = body.createDiv({ cls: "relay-cal-body-inner" });
		this.setupNavZones(inner);

		this.renderGutter(inner);

		const cols = inner.createDiv({ cls: "relay-cal-columns" });
		this.dayColumns = [];
		for (let i = 0; i < 7; i++) {
			const d = this.dayAt(i);
			const col = cols.createDiv({ cls: "relay-cal-day-col" });
			this.dayColumns.push({ el: col, day: d });
			for (let h = 0; h < 24; h++) col.createDiv({ cls: "relay-cal-hour-line" });

			const dayEvents = timed.filter((e) => sameDay(e.start, d));
			for (const pe of layoutEvents(dayEvents)) this.renderEvent(col, pe, d);

			if (isToday(d)) this.renderNowLine(col);
			this.setupDragCreate(col, d);
		}

		this.restoreScroll(body);
	}

	private renderDay(root: HTMLElement, dayIndex: number): void {
		const d = this.dayAt(dayIndex);
		const dEnd = new Date(d);
		dEnd.setDate(dEnd.getDate() + 1);

		const rawEvents = this.eventSource.getEventsInRange(d, dEnd);
		const events = this.applyOptimistic(rawEvents);
		const allDay: CalendarEvent[] = [];
		const timed: CalendarEvent[] = [];
		for (const e of events) (e.allDay ? allDay : timed).push(e);

		if (allDay.length) {
			const row = root.createDiv({ cls: "relay-cal-allday-mobile" });
			for (const e of allDay) {
				const el = row.createDiv({ cls: "relay-cal-event relay-cal-event-allday" });
				el.textContent = e.name;
				if (e.color) {
					el.style.setProperty("--event-color", e.color);
					el.style.color = this.getContrastColor(e.color);
				}
				el.addEventListener("click", () => this.openEvent(e));
			}
		}

		const body = root.createDiv({ cls: "relay-cal-body" });
		const inner = body.createDiv({ cls: "relay-cal-body-inner" });
		this.renderGutter(inner);

		const cols = inner.createDiv({ cls: "relay-cal-columns" });
		const col = cols.createDiv({ cls: "relay-cal-day-col" });
		this.dayColumns = [{ el: col, day: d }];
		for (let h = 0; h < 24; h++) col.createDiv({ cls: "relay-cal-hour-line" });
		for (const pe of layoutEvents(timed)) this.renderEvent(col, pe, d);
		if (isToday(d)) this.renderNowLine(col);
		this.setupDragCreate(col, d);

		this.restoreScroll(body);
	}

	private renderGutter(parent: HTMLElement): void {
		const gutter = parent.createDiv({ cls: "relay-cal-gutter" });
		for (let h = 0; h < 24; h++) {
			const label = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
			gutter.createDiv({ cls: "relay-cal-hour-label", text: label });
		}
	}

	private renderAllDayRow(root: HTMLElement, events: CalendarEvent[]): void {
		const row = root.createDiv({ cls: "relay-cal-allday-row" });
		row.createDiv({ cls: "relay-cal-gutter relay-cal-allday-label", text: "all-day" });
		const cells = row.createDiv({ cls: "relay-cal-allday-cells" });
		for (let i = 0; i < 7; i++) {
			const d = this.dayAt(i);
			const cell = cells.createDiv({ cls: "relay-cal-allday-cell" });
			for (const e of events) {
				if (!sameDay(e.start, d)) continue;
				const el = cell.createDiv({ cls: "relay-cal-event relay-cal-event-allday" });
				el.textContent = e.name;
				if (e.color) {
					el.style.setProperty("--event-color", e.color);
					el.style.color = this.getContrastColor(e.color);
				}
				el.addEventListener("click", () => this.openEvent(e));
			}
		}
	}

	private renderEvent(dayCol: HTMLElement, pe: PositionedEvent, dayStart: Date): void {
		const GAP = 2;
		const EVENT_GAP = 1;
		const startMin = minuteOfDay(pe.start);
		const endMin = minuteOfDay(pe.end);
		const top = Math.max(0, startMin) + EVENT_GAP;
		const bottom = Math.min(24 * 60, endMin) - EVENT_GAP;
		const height = Math.max(0, bottom - top);

		const el = dayCol.createDiv({ cls: "relay-cal-event" });
		el.style.top = `${top}px`;
		el.style.height = `${height}px`;
		el.style.left = `calc(${(pe.column / pe.totalColumns) * 100}% + ${GAP}px)`;
		el.style.width = `calc(${100 / pe.totalColumns}% - ${GAP * 2}px)`;
		el.dataset.eventPath = pe.filePath;
		el.dataset.eventStart = String(pe.start.getTime());

		if (pe.color) {
			el.style.setProperty("--event-color", pe.color);
			el.style.color = this.getContrastColor(pe.color);
		}

		const durMin = endMin - startMin;
		if (durMin >= 20) {
			const time = pe.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
			el.createDiv({ cls: "relay-cal-event-time", text: time });
			el.createDiv({ cls: "relay-cal-event-name", text: pe.name });
		} else if (durMin >= 15) {
			const time = pe.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
			const row = el.createDiv({ cls: "relay-cal-event-inline" });
			row.createSpan({ cls: "relay-cal-event-time", text: time });
			row.createSpan({ cls: "relay-cal-event-name", text: ` ${pe.name}` });
		} else if (durMin >= 10) {
			el.createDiv({ cls: "relay-cal-event-name", text: pe.name });
		}

		el.addEventListener("click", () => {
			if (this.preventClick) {
				this.preventClick = false;
				return;
			}
			this.openEvent(pe);
		});
		el.addEventListener("mousedown", (e) => {
			if (e.button === 1) {
				e.preventDefault();
				e.stopPropagation();
				this.editEvent(pe);
			}
		});
		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showEventMenu(pe, e.clientX, e.clientY);
		});

		const topHandle = el.createDiv({ cls: "relay-cal-event-resize relay-cal-event-resize-top" });
		topHandle.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.stopPropagation();
			e.preventDefault();
			this.startResize(el, pe, dayCol, dayStart, "top", e.clientY, false);
		});
		topHandle.addEventListener("touchstart", (e) => {
			e.stopPropagation();
			e.preventDefault();
			const t = e.touches[0]; if (!t) return;
			this.startResize(el, pe, dayCol, dayStart, "top", t.clientY, true);
		}, { passive: false });

		const bottomHandle = el.createDiv({ cls: "relay-cal-event-resize relay-cal-event-resize-bottom" });
		bottomHandle.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.stopPropagation();
			e.preventDefault();
			this.startResize(el, pe, dayCol, dayStart, "bottom", e.clientY, false);
		});
		bottomHandle.addEventListener("touchstart", (e) => {
			e.stopPropagation();
			e.preventDefault();
			const t = e.touches[0]; if (!t) return;
			this.startResize(el, pe, dayCol, dayStart, "bottom", t.clientY, true);
		}, { passive: false });

		this.setupEventDrag(el, pe, dayCol, dayStart);
	}

	private renderNowLine(dayCol: HTMLElement): void {
		const now = new Date();
		const min = minuteOfDay(now);
		const line = dayCol.createDiv({ cls: "relay-cal-now" });
		line.style.top = `${min}px`;
		line.dataset["nowLine"] = "1";
	}

	private startNowLine(): void {
		this.nowInterval = window.setInterval(() => {
			const now = new Date();
			const min = minuteOfDay(now);
			this.contentEl.querySelectorAll("[data-now-line]").forEach((el) => {
				(el as HTMLElement).style.top = `${min}px`;
			});

			// Auto-refresh only when the date rolls over while viewing the current period
			if (this.mobile) {
				const viewingToday = this.mobileDay === new Date(now.getTime() - 60000).getDay();
				if (viewingToday && now.getDay() !== this.mobileDay) this.goToday();
			} else {
				const prevWeekStart = weekStartOf(new Date(now.getTime() - 60000));
				if (this.weekStart.getTime() === prevWeekStart.getTime()) {
					const currentWeekStart = weekStartOf(now);
					if (currentWeekStart.getTime() !== this.weekStart.getTime()) this.goToday();
				}
			}
		}, 60000);
	}

	private restoreScroll(body: HTMLElement): void {
		body.addEventListener("scroll", () => { this.savedScroll = body.scrollTop; });
		if (this.firstRender) {
			body.scrollTop = Math.max(0, this.currentTimeOffset());
			this.firstRender = false;
		} else if (this.savedScroll != null) {
			body.scrollTop = this.savedScroll;
		}
	}

	private scrollToSaved(): void {
		const body = this.contentEl.querySelector(".relay-cal-body") as HTMLElement | null;
		if (!body) return;
		body.scrollTop = this.savedScroll ?? Math.max(0, this.currentTimeOffset());
	}

	private currentTimeOffset(): number {
		return minuteOfDay(new Date()) - 60;
	}

	// ---- pointer tracking ----

	private trackPointer(
		isTouch: boolean,
		onMove: (cx: number, cy: number) => void,
		onUp: (cx: number, cy: number) => void,
	): void {
		if (isTouch) {
			const tm = (e: TouchEvent) => {
				e.preventDefault();
				const t = e.touches[0]; if (!t) return;
				onMove(t.clientX, t.clientY);
			};
			const tu = (e: TouchEvent) => {
				document.removeEventListener("touchmove", tm);
				document.removeEventListener("touchend", tu);
				document.removeEventListener("touchcancel", tu);
				const t = e.changedTouches[0]; if (!t) return;
				onUp(t.clientX, t.clientY);
			};
			document.addEventListener("touchmove", tm, { passive: false });
			document.addEventListener("touchend", tu);
			document.addEventListener("touchcancel", tu);
		} else {
			const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
			const mu = (e: MouseEvent) => {
				document.removeEventListener("mousemove", mm);
				document.removeEventListener("mouseup", mu);
				onUp(e.clientX, e.clientY);
			};
			document.addEventListener("mousemove", mm);
			document.addEventListener("mouseup", mu);
		}
	}

	private holdTouch(
		el: HTMLElement,
		holdMs: number,
		filter: (e: TouchEvent) => boolean,
		onHeld: (cx: number, cy: number) => void,
	): void {
		let timer: number | null = null;
		let origin: { x: number; y: number } | null = null;

		el.addEventListener("touchstart", (e) => {
			if (!filter(e)) return;
			const t = e.touches[0]; if (!t) return;
			origin = { x: t.clientX, y: t.clientY };
			timer = window.setTimeout(() => {
				timer = null;
				if (!origin) return;
				onHeld(origin.x, origin.y);
				origin = null;
			}, holdMs);
		}, { passive: true });

		el.addEventListener("touchmove", (e) => {
			if (!timer || !origin) return;
			const t = e.touches[0]; if (!t) return;
			if (Math.abs(t.clientX - origin.x) + Math.abs(t.clientY - origin.y) > 20) {
				clearTimeout(timer);
				timer = null;
				origin = null;
			}
		}, { passive: true });

		const cancel = () => {
			if (timer) { clearTimeout(timer); timer = null; }
			origin = null;
		};
		el.addEventListener("touchend", cancel);
		el.addEventListener("touchcancel", cancel);
	}

	// ---- drag to create ----

	private setupDragCreate(col: HTMLElement, day: Date): void {
		const beginCreate = (startY: number, isTouch: boolean) => {
			const preview = col.createDiv({ cls: "relay-cal-drag-preview" });
			preview.style.top = `${startY}px`;
			preview.style.height = "15px";

			this.dragging = true;
			this.trackPointer(isTouch, (_cx, cy) => {
				const curY = cy - col.getBoundingClientRect().top;
				const top = Math.min(startY, curY);
				const height = Math.max(15, Math.abs(curY - startY));
				preview.style.top = `${top}px`;
				preview.style.height = `${height}px`;
			}, (_cx, cy) => {
				const endY = cy - col.getBoundingClientRect().top;
				this.flushDrag();
				preview.remove();

				const minY = snap15(Math.min(startY, endY));
				const maxY = snap15(Math.max(startY, endY));
				if (maxY - minY < 15) return;

				const start = new Date(day);
				start.setHours(Math.floor(minY / 60), minY % 60, 0, 0);
				const end = new Date(day);
				const endMin = Math.max(minY + 15, maxY);
				end.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

				new EventModal(this.app, { folder: this.calendarConfig.event_folder, eventTag: this.calendarConfig.event_tag, start, end }).open();
			});
		};

		col.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			if ((e.target as HTMLElement).closest(".relay-cal-event")) return;
			e.preventDefault();
			beginCreate(e.clientY - col.getBoundingClientRect().top, false);
		});

		this.holdTouch(col, 300,
			(e) => !(e.target as HTMLElement).closest(".relay-cal-event"),
			(_cx, cy) => beginCreate(cy - col.getBoundingClientRect().top, true),
		);
	}

	// ---- drag to move ----

	private setupEventDrag(el: HTMLElement, event: PositionedEvent, dayCol: HTMLElement, dayStart: Date): void {
		const beginDrag = (startX: number, startY: number, isTouch: boolean) => {
			let active = false;
			let lastPreviewCol: HTMLElement | null = null;
			const originalStyles = new Map<HTMLElement, { width: string; left: string }>();

			const colRect = dayCol.getBoundingClientRect();
			const eventStartMin = minuteOfDay(event.start);
			const grabOffset = (startY - colRect.top) - eventStartMin;
			const duration = minuteOfDay(event.end) - eventStartMin;

			const ghost = document.createElement("div");
			ghost.className = "relay-cal-drag-ghost";
			ghost.style.height = `${duration}px`;

			let currentCol = dayCol;
			let currentDay = new Date(dayStart);

			const clearPreview = () => {
				if (lastPreviewCol) {
					// Restore original styles
					for (const [eventEl, style] of originalStyles) {
						eventEl.style.width = style.width;
						eventEl.style.left = style.left;
					}
					originalStyles.clear();
					lastPreviewCol = null;
				}
			};

			const applyPreview = (col: HTMLElement, previewEvents: PositionedEvent[]) => {
				clearPreview();
				lastPreviewCol = col;

				// Store original styles and apply new ones
				for (const pe of previewEvents) {
					const eventEl = col.querySelector(`[data-event-path="${CSS.escape(pe.filePath)}"][data-event-start="${pe.start.getTime()}"]`) as HTMLElement | null;
					if (eventEl) {
						originalStyles.set(eventEl, {
							width: eventEl.style.width,
							left: eventEl.style.left,
						});
						eventEl.style.left = `calc(${(pe.column / pe.totalColumns) * 100}% + 2px)`;
						eventEl.style.width = `calc(${100 / pe.totalColumns}% - 4px)`;
					}
				}
			};

			this.dragging = true;
			if (isTouch) el.addClass("is-held");
			this.trackPointer(isTouch, (cx, cy) => {
				if (!active && Math.abs(cx - startX) + Math.abs(cy - startY) > 5) {
					active = true;
					el.removeClass("is-held");
					el.addClass("is-dragging");
					dayCol.appendChild(ghost);
				}
				if (!active) return;

				for (const { el: col, day } of this.dayColumns) {
					const r = col.getBoundingClientRect();
					if (cx >= r.left && cx < r.right) {
						const dayChanged = col !== currentCol;
						if (dayChanged) {
							currentCol = col;
							currentDay = new Date(day);
							col.appendChild(ghost);
						}
						break;
					}
				}

				const targetRect = currentCol.getBoundingClientRect();
				const newTop = cy - targetRect.top - grabOffset;
				ghost.style.top = `${newTop}px`;

				// Dynamic layout preview with other events
				const newStartMin = Math.max(0, Math.min(1440, newTop));
				const previewEvents = this.calculateDragPreviewWithOthers(event, currentDay, newStartMin, duration);
				if (previewEvents) {
					const ghostPos = previewEvents.find(p => p.filePath === event.filePath);
					if (ghostPos) {
						ghost.style.left = `calc(${(ghostPos.column / ghostPos.totalColumns) * 100}% + 2px)`;
						ghost.style.width = `calc(${100 / ghostPos.totalColumns}% - 4px)`;
					}
					applyPreview(currentCol, previewEvents);
				}
			}, (cx, cy) => {
				el.removeClass("is-held");
				clearPreview();
				ghost.remove();

				if (!active) {
					this.flushDrag();
					if (isTouch) {
						this.preventClick = true;
						setTimeout(() => { this.preventClick = false; }, 400);
						this.showEventMenu(event, cx, cy);
					}
					return;
				}

				const targetRect = currentCol.getBoundingClientRect();
				const newStartMin = snap15(cy - targetRect.top - grabOffset);
				const newStart = new Date(currentDay);
				newStart.setHours(Math.floor(newStartMin / 60), newStartMin % 60, 0, 0);
				const newEnd = new Date(newStart.getTime() + duration * 60000);

				this.preventClick = true;
				setTimeout(() => { this.preventClick = false; }, 400);

				this.optimistic.set(event.filePath + "|" + event.start.getTime(), { start: newStart, end: newEnd, ts: Date.now() });
				this.scheduleOptimisticCleanup();
				this.moveEvent(event, newStart, newEnd);
				this.flushDrag();
			});
		};

		el.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			beginDrag(e.clientX, e.clientY, false);
		});

		this.holdTouch(el, 200,
			() => true,
			(cx, cy) => beginDrag(cx, cy, true),
		);
	}

	// ---- edge resize ----

	private startResize(
		el: HTMLElement, event: PositionedEvent,
		dayCol: HTMLElement, dayStart: Date,
		edge: "top" | "bottom", initY: number, isTouch: boolean,
	): void {
		const GAP = 2;
		const eventStartMin = minuteOfDay(event.start);
		const eventEndMin = minuteOfDay(event.end);
		let resizing = false;

		this.dragging = true;
		this.trackPointer(isTouch, (_cx, cy) => {
			if (!resizing && Math.abs(cy - initY) > 5) resizing = true;
			if (!resizing) return;

			const colRect = dayCol.getBoundingClientRect();
			if (edge === "bottom") {
				const newEndMin = Math.max(eventStartMin + 15, cy - colRect.top);
				el.style.height = `${newEndMin - eventStartMin - GAP * 2}px`;
			} else {
				const newStartMin = Math.min(eventEndMin - 15, cy - colRect.top);
				el.style.top = `${newStartMin + GAP}px`;
				el.style.height = `${eventEndMin - newStartMin - GAP * 2}px`;
			}
		}, (_cx, cy) => {
			if (!resizing) {
				this.flushDrag();
				return;
			}

			this.preventClick = true;
			setTimeout(() => { this.preventClick = false; }, 400);

			const colRect = dayCol.getBoundingClientRect();
			let newStart: Date, newEnd: Date;

			if (edge === "bottom") {
				const newEndMin = Math.max(eventStartMin + 15, snap15(cy - colRect.top));
				newStart = new Date(event.start);
				newEnd = new Date(dayStart);
				newEnd.setHours(Math.floor(newEndMin / 60), newEndMin % 60, 0, 0);
			} else {
				const newStartMin = Math.min(eventEndMin - 15, snap15(cy - colRect.top));
				newStart = new Date(dayStart);
				newStart.setHours(Math.floor(newStartMin / 60), newStartMin % 60, 0, 0);
				newEnd = new Date(event.end);
			}

			this.optimistic.set(event.filePath + "|" + event.start.getTime(), { start: newStart, end: newEnd, ts: Date.now() });
			this.scheduleOptimisticCleanup();
			this.moveEvent(event, newStart, newEnd);
			this.flushDrag();
		});
	}

	private applyOptimistic(events: CalendarEvent[]): CalendarEvent[] {
		if (this.optimistic.size === 0) return events;
		const now = Date.now();
		const result = events.map((e) => {
			const key = e.filePath + "|" + e.start.getTime();
			const o = this.optimistic.get(key);
			if (o) return { ...e, start: o.start, end: o.end };
			return e;
		});
		for (const [key, target] of this.optimistic) {
			if (now - target.ts > 5000) {
				this.optimistic.delete(key);
				continue;
			}
			const filePath = key.split("|")[0]!;
			const caughtUp = events.some((e) =>
				e.filePath === filePath &&
				e.start.getTime() === target.start.getTime() &&
				e.end.getTime() === target.end.getTime()
			);
			if (caughtUp) this.optimistic.delete(key);
		}
		return result;
	}

	private requestRender(): void {
		if (this.dragging) {
			this.renderQueued = true;
			return;
		}
		if (Date.now() < this.suppressUntil) return;
		this.render();
	}

	private scheduleOptimisticCleanup(): void {
		this.suppressUntil = Date.now() + 300;
		if (this.deferredRender != null) window.clearTimeout(this.deferredRender);
		this.deferredRender = window.setTimeout(() => {
			this.deferredRender = null;
			this.optimistic.clear();
			this.render();
		}, 500);
	}

	private flushDrag(): void {
		this.dragging = false;
		if (this.deferredRender != null) {
			window.clearTimeout(this.deferredRender);
			this.deferredRender = null;
		}
		if (this.renderQueued || this.optimistic.size > 0) {
			this.renderQueued = false;
			this.render();
		}
	}

	// ---- event actions ----

	private async editEvent(event: CalendarEvent): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (!(file instanceof TFile)) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;

		let mode: "this" | "future" | "all" | null = null;
		if (event.sourceRecurrence) {
			mode = await askRecurrenceEdit(this.app);
			if (!mode) return;
		}

		const opts: EventModalOpts = {
			folder: this.calendarConfig.event_folder,
			eventTag: this.calendarConfig.event_tag,
			start: event.start,
			end: event.end,
			name: event.name,
			location: (fm?.location as string) ?? "",
			color: event.color ?? "",
		};

		if (!mode || mode === "all") {
			opts.filePath = event.filePath;
			opts.recurrence = (fm?.recurrence as string) ?? "";
		} else if (mode === "this") {
			opts.recurrence = "";
			opts.onSaved = async () => {
				await this.app.fileManager.processFrontMatter(file, (sourceFm) => {
					if (!sourceFm.exdates) sourceFm.exdates = [];
					const dateStr = formatDateValue(event.start);
					if (!sourceFm.exdates.includes(dateStr)) sourceFm.exdates.push(dateStr);
				});
			};
		} else {
			opts.recurrence = event.sourceRecurrence ?? "";
			opts.onSaved = async () => {
				await this.addUntilToSource(file, event.start);
			};
		}

		new EventModal(this.app, opts).open();
	}

	private async confirmDelete(event: CalendarEvent): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (!(file instanceof TFile)) return;

		if (event.sourceRecurrence) {
			const mode = await askRecurrenceEdit(this.app);
			if (!mode) return;

			if (mode === "all") {
				const modal = new ConfirmDeleteModal(this.app, event.name, async () => {
					await this.app.vault.trash(file, true);
				});
				modal.open();
			} else if (mode === "this") {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					if (!fm.exdates) fm.exdates = [];
					const dateStr = formatDateValue(event.start);
					if (!fm.exdates.includes(dateStr)) fm.exdates.push(dateStr);
				});
				await this.trashIfNoOccurrences(file);
			} else {
				await this.addUntilToSource(file, event.start);
				await this.trashIfNoOccurrences(file);
			}
		} else {
			const modal = new ConfirmDeleteModal(this.app, event.name, async () => {
				await this.app.vault.trash(file, true);
			});
			modal.open();
		}
	}

	private async trashIfNoOccurrences(file: TFile): Promise<void> {
		let recurrence = "";
		let startStr = "";
		let exdatesList: string[] = [];
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			recurrence = fm.recurrence ?? "";
			startStr = fm.interval?.start ?? "";
			if (Array.isArray(fm.exdates)) exdatesList = fm.exdates.map(String);
		});

		if (!recurrence || !startStr) return;
		const start = new Date(startStr);
		if (isNaN(start.getTime())) return;

		try {
			const dtstart = datetime(
				start.getFullYear(), start.getMonth() + 1, start.getDate(),
				start.getHours(), start.getMinutes(), start.getSeconds(),
			);
			const rule = rrulestr(`RRULE:${recurrence}`, { dtstart });

			if (exdatesList.length === 0) {
				if (rule.after(dtstart, true)) return;
			} else {
				const exdates = new Set(exdatesList);
				let cursor: Date | null = dtstart;
				while (cursor) {
					const y = cursor.getUTCFullYear();
					const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
					const d = String(cursor.getUTCDate()).padStart(2, "0");
					if (!exdates.has(`${y}-${m}-${d}`)) return;
					cursor = rule.after(cursor, false);
				}
			}

			await this.app.vault.trash(file, true);
		} catch { /* keep the file if rrule parsing fails */ }
	}

	private async moveEvent(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
		if (newStart.getTime() === event.start.getTime() && newEnd.getTime() === event.end.getTime()) return;

		if (event.sourceRecurrence) {
			const choice = await askRecurrenceEdit(this.app);
			if (!choice) {
				this.optimistic.delete(event.filePath + "|" + event.start.getTime());
				this.render();
				return;
			}

			switch (choice) {
				case "all":
					await this.moveAll(event, newStart, newEnd);
					break;
				case "this":
					await this.moveThis(event, newStart, newEnd);
					break;
				case "future":
					await this.moveFuture(event, newStart, newEnd);
					break;
			}
		} else {
			await this.moveDirect(event, newStart, newEnd);
		}
	}

	private async moveDirect(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (!(file instanceof TFile)) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (!fm.interval) fm.interval = {};
			fm.interval.start = toLocalISO(newStart);
			fm.interval.end = toLocalISO(newEnd);
		});
	}

	private async moveAll(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (!(file instanceof TFile)) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (!fm.interval) return;
			const originalStart = new Date(fm.interval.start);
			const originalEnd = new Date(fm.interval.end);
			originalStart.setHours(newStart.getHours(), newStart.getMinutes(), 0, 0);
			originalEnd.setHours(newEnd.getHours(), newEnd.getMinutes(), 0, 0);
			fm.interval.start = toLocalISO(originalStart);
			fm.interval.end = toLocalISO(originalEnd);
		});
	}

	private async moveThis(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (!(file instanceof TFile)) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;

		await this.app.fileManager.processFrontMatter(file, (sourceFm) => {
			if (!sourceFm.exdates) sourceFm.exdates = [];
			const dateStr = formatDateValue(event.start);
			if (!sourceFm.exdates.includes(dateStr)) sourceFm.exdates.push(dateStr);
		});

		await createEventNote(
			this.app, this.calendarConfig.event_folder, this.calendarConfig.event_tag, event.name,
			newStart, newEnd,
			(fm?.location as string) ?? "",
			event.color ?? "",
			"",
		);
	}

	private async moveFuture(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (!(file instanceof TFile)) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;

		await this.addUntilToSource(file, event.start);
		await createEventNote(
			this.app, this.calendarConfig.event_folder, this.calendarConfig.event_tag, event.name,
			newStart, newEnd,
			(fm?.location as string) ?? "",
			event.color ?? "",
			event.sourceRecurrence ?? "",
		);
	}

	private async addUntilToSource(file: TFile, instanceStart: Date): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (fm.recurrence) {
				const untilDate = new Date(instanceStart);
				untilDate.setDate(untilDate.getDate() - 1);
				const untilStr = `${untilDate.getFullYear()}${pad(untilDate.getMonth() + 1)}${pad(untilDate.getDate())}T235959`;
				fm.recurrence = addUntilToRrule(fm.recurrence, untilStr);
			}
		});
	}

	// ---- helpers ----

	private btn(parent: HTMLElement, text: string, cls: string, onClick: () => void): HTMLElement {
		const b = parent.createEl("button", { cls, text });
		b.addEventListener("click", onClick);
		return b;
	}

	private navBtn(parent: HTMLElement, text: string, dir: 1 | -1, extraCls?: string): void {
		const cls = extraCls ? `relay-cal-nav-btn ${extraCls}` : "relay-cal-nav-btn";
		const b = parent.createEl("button", { cls, text });
		let longFired = false;
		b.addEventListener("click", (e) => {
			if (longFired) { longFired = false; return; }
			this.shiftDays(e.altKey ? dir : dir * 7);
		});
		if (this.mobile) {
			let timer: number | null = null;
			b.addEventListener("touchstart", () => {
				longFired = false;
				timer = window.setTimeout(() => { timer = null; longFired = true; this.shiftDays(dir); }, 400);
			});
			const cancel = () => { if (timer != null) { window.clearTimeout(timer); timer = null; } };
			b.addEventListener("touchend", cancel);
			b.addEventListener("touchcancel", cancel);
		}
	}

	private showEventMenu(event: CalendarEvent, x: number, y: number): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Edit event");
			item.setIcon("pencil");
			item.onClick(() => this.editEvent(event));
		});
		menu.addItem((item) => {
			item.setTitle("Delete event");
			item.setIcon("trash");
			item.onClick(() => this.confirmDelete(event));
		});
		menu.showAtPosition({ x, y });
	}

	private openEvent(event: CalendarEvent): void {
		const file = this.app.vault.getAbstractFileByPath(event.filePath);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	private shiftDays(days: number): void {
		this.weekStart.setDate(this.weekStart.getDate() + days);
		this.render();
	}

	goToday(): void {
		this.weekStart = weekStartOf(new Date());
		this.mobileDay = new Date().getDay();
		this.render();
	}

	private dayAt(i: number): Date {
		const d = new Date(this.weekStart);
		d.setDate(d.getDate() + i);
		return d;
	}

	private getContrastColor(color: string): string {
		const hex = color.replace("#", "");
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
		return luminance > 0.5 ? "var(--text-normal)" : "var(--text-on-accent)";
	}

	private calculateDragPreviewWithOthers(
		draggedEvent: PositionedEvent,
		targetDay: Date,
		startMin: number,
		durationMin: number,
	): PositionedEvent[] | null {
		const dEnd = new Date(targetDay);
		dEnd.setDate(dEnd.getDate() + 1);
		const dayEvents = this.eventSource.getEventsInRange(targetDay, dEnd);

		// Filter out the dragged event (by filePath and original start)
		const otherEvents = dayEvents.filter(
			e => !(e.filePath === draggedEvent.filePath && e.start.getTime() === draggedEvent.start.getTime())
		);

		// Create preview event
		const newStart = new Date(targetDay);
		newStart.setHours(Math.floor(startMin / 60), Math.floor(startMin) % 60, 0, 0);
		const newEnd = new Date(newStart.getTime() + durationMin * 60000);

		const previewEvent: CalendarEvent = {
			filePath: draggedEvent.filePath,
			name: draggedEvent.name,
			start: newStart,
			end: newEnd,
			allDay: draggedEvent.allDay,
			color: draggedEvent.color,
			recurrence: draggedEvent.recurrence,
			sourceRecurrence: draggedEvent.sourceRecurrence,
		};

		// Get layout for all events including preview
		return layoutEvents([...otherEvents, previewEvent]);
	}

	private setupNavZones(container: HTMLElement): void {
		const zoneWidth = 24;
		const leftZone = container.createDiv({ cls: "relay-cal-nav-zone relay-cal-nav-zone-left" });
		const rightZone = container.createDiv({ cls: "relay-cal-nav-zone relay-cal-nav-zone-right" });
		leftZone.style.width = `${zoneWidth}px`;
		rightZone.style.width = `${zoneWidth}px`;

		const handleNav = (e: MouseEvent | TouchEvent, dir: 1 | -1) => {
			if (e instanceof MouseEvent && e.button !== 0) return;
			const isAlt = e instanceof MouseEvent ? e.altKey : false;
			this.shiftDays(isAlt ? dir : dir * 7);
		};

		leftZone.addEventListener("click", (e) => handleNav(e, -1));
		rightZone.addEventListener("click", (e) => handleNav(e, 1));

		leftZone.addEventListener("touchstart", (e) => {
			e.preventDefault();
			handleNav(e, -1);
		}, { passive: false });
		rightZone.addEventListener("touchstart", (e) => {
			e.preventDefault();
			handleNav(e, 1);
		}, { passive: false });
	}
}

class ConfirmDeleteModal extends Modal {
	private name: string;
	private onConfirm: () => Promise<void>;

	constructor(app: import("obsidian").App, name: string, onConfirm: () => Promise<void>) {
		super(app);
		this.name = name;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.titleEl.setText("Delete event");
		this.contentEl.createEl("p", { text: `Delete "${this.name}"? This will trash the note.` });
		const actions = this.contentEl.createDiv({ cls: "relay-cal-modal-actions" });
		actions.createDiv({ cls: "relay-cal-modal-spacer" });
		const cancel = actions.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const del = actions.createEl("button", { cls: "mod-warning", text: "Delete" });
		del.addEventListener("click", async () => {
			await this.onConfirm();
			this.close();
		});
	}
}

function snap15(px: number): number {
	return Math.max(0, Math.min(1440, Math.round(px / 15) * 15));
}

function weekStartOf(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - d.getDay());
	return d;
}

function sameDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear()
		&& a.getMonth() === b.getMonth()
		&& a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
	return sameDay(d, new Date());
}

function minuteOfDay(d: Date): number {
	return d.getHours() * 60 + d.getMinutes();
}
