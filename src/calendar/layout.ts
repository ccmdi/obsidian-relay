import { CalendarEvent, PositionedEvent } from "./types";

export function layoutEvents(events: CalendarEvent[]): PositionedEvent[] {
	if (events.length === 0) return [];

	const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());

	const columns: number[] = [];
	const assignments: { event: CalendarEvent; column: number }[] = [];

	for (const event of sorted) {
		const startMs = event.start.getTime();
		let placed = false;
		for (let col = 0; col < columns.length; col++) {
			if (columns[col]! <= startMs) {
				columns[col] = event.end.getTime();
				assignments.push({ event, column: col });
				placed = true;
				break;
			}
		}
		if (!placed) {
			columns.push(event.end.getTime());
			assignments.push({ event, column: columns.length - 1 });
		}
	}

	// Compute overlap clusters to determine totalColumns per event
	const result: PositionedEvent[] = [];
	const n = assignments.length;
	let i = 0;

	while (i < n) {
		let clusterEnd = assignments[i]!.event.end.getTime();
		let j = i + 1;
		while (j < n && assignments[j]!.event.start.getTime() < clusterEnd) {
			clusterEnd = Math.max(clusterEnd, assignments[j]!.event.end.getTime());
			j++;
		}

		let maxCol = 0;
		for (let k = i; k < j; k++) {
			maxCol = Math.max(maxCol, assignments[k]!.column);
		}
		const totalColumns = maxCol + 1;

		for (let k = i; k < j; k++) {
			const a = assignments[k]!;
			result.push({ ...a.event, column: a.column, totalColumns });
		}

		i = j;
	}

	return result;
}
