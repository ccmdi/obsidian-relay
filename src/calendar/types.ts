export interface CalendarEvent {
	filePath: string;
	name: string;
	start: Date;
	end: Date;
	allDay: boolean;
	color: string | null;
	recurrence: string | null;
	sourceRecurrence: string | null;
	originalStart?: Date;
	originalEnd?: Date;
}

export interface PositionedEvent extends CalendarEvent {
	column: number;
	totalColumns: number;
}
