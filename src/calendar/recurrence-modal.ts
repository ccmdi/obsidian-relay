import { App, Modal } from "obsidian";

export type RecurrenceEditChoice = "this" | "future" | "all";

export class RecurrenceEditModal extends Modal {
	private resolved = false;
	private resolve: (choice: RecurrenceEditChoice | null) => void;

	constructor(app: App, resolve: (choice: RecurrenceEditChoice | null) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen(): void {
		this.titleEl.setText("Edit recurring event");
		this.modalEl.addClass("relay-cal-modal");
		this.contentEl.createEl("p", {
			text: "This is a recurring event. How should this change apply?",
			cls: "relay-cal-recurrence-desc",
		});
		const actions = this.contentEl.createDiv({ cls: "relay-cal-recurrence-actions" });

		const thisBtn = actions.createEl("button", { text: "Just this one" });
		thisBtn.addEventListener("click", () => this.pick("this"));

		const futureBtn = actions.createEl("button", { text: "This and future" });
		futureBtn.addEventListener("click", () => this.pick("future"));

		const allBtn = actions.createEl("button", { cls: "mod-cta", text: "All events" });
		allBtn.addEventListener("click", () => this.pick("all"));
	}

	private pick(choice: RecurrenceEditChoice): void {
		this.resolved = true;
		this.resolve(choice);
		this.close();
	}

	onClose(): void {
		if (!this.resolved) this.resolve(null);
	}
}

export function askRecurrenceEdit(app: App): Promise<RecurrenceEditChoice | null> {
	return new Promise((resolve) => {
		new RecurrenceEditModal(app, resolve).open();
	});
}
