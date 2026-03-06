type Payload = Record<string, unknown>;

export function generateICS(id: string, payload: Payload): string {
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Relay//EN",
		"BEGIN:VEVENT",
		`UID:${id}`,
		`DTSTAMP:${formatDateTime(new Date().toISOString())}`,
	];

	const interval = payload.interval as { start?: string; end?: string } | undefined;
	const allDay = payload.all_day === true;

	if (allDay) {
		if (interval?.start) lines.push(`DTSTART;VALUE=DATE:${formatDate(interval.start)}`);
		if (interval?.end) lines.push(`DTEND;VALUE=DATE:${formatDate(interval.end)}`);
	} else {
		if (interval?.start) lines.push(`DTSTART:${formatDateTime(interval.start)}`);
		if (interval?.end) lines.push(`DTEND:${formatDateTime(interval.end)}`);
	}

	if (payload.name) lines.push(fold(`SUMMARY:${escape(String(payload.name))}`));
	if (payload.location) lines.push(fold(`LOCATION:${escape(String(payload.location))}`));
	if (payload.description) lines.push(fold(`DESCRIPTION:${escape(String(payload.description))}`));

	const status = String(payload.status || "confirmed").toUpperCase();
	lines.push(`STATUS:${status}`);

	if (payload.color) lines.push(`COLOR:${payload.color}`);

	if (typeof payload.recurrence === "string") {
		lines.push(`RRULE:${payload.recurrence}`);
	}

	if (Array.isArray(payload.exdates) && interval?.start) {
		const startUtc = formatDateTime(interval.start);
		const timeOfDay = startUtc.slice(8); // "THHMMSSZ"
		for (const d of payload.exdates) {
			const dateStr = String(d).replace(/-/g, "");
			if (allDay) {
				lines.push(`EXDATE;VALUE=DATE:${dateStr}`);
			} else {
				lines.push(`EXDATE:${dateStr}${timeOfDay}`);
			}
		}
	}

	if (Array.isArray(payload.reminders)) {
		for (const r of payload.reminders) {
			const trigger = toICSDuration(String(r));
			if (!trigger) continue;
			lines.push("BEGIN:VALARM", `TRIGGER:-${trigger}`, "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM");
		}
	}

	lines.push("END:VEVENT", "END:VCALENDAR");
	return lines.join("\r\n") + "\r\n";
}

function formatDateTime(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return iso.replace(/[-:]/g, "");
	return (
		d.getUTCFullYear().toString() +
		pad(d.getUTCMonth() + 1) +
		pad(d.getUTCDate()) +
		"T" +
		pad(d.getUTCHours()) +
		pad(d.getUTCMinutes()) +
		pad(d.getUTCSeconds()) +
		"Z"
	);
}

function formatDate(iso: string): string {
	return iso.replace(/-/g, "").slice(0, 8);
}

function pad(n: number): string {
	return n < 10 ? "0" + n : String(n);
}

function escape(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\n/g, "\\n");
}

function fold(line: string): string {
	if (line.length <= 75) return line;
	const chunks = [line.slice(0, 75)];
	for (let i = 75; i < line.length; i += 74) {
		chunks.push(" " + line.slice(i, i + 74));
	}
	return chunks.join("\r\n");
}

function toICSDuration(dur: string): string | null {
	const m = dur.match(/^(\d+)(m|h|d)$/);
	if (!m) return null;
	const [, n, unit] = m;
	if (unit === "d") return `P${n}D`;
	return `PT${n}${unit!.toUpperCase()}`;
}
