export interface CalendarEvent {
	filePath: string;
	name: string;
	start: Date;
	end: Date;
	allDay: boolean;
	color: string | null;
	recurrence: string | null;
	sourceRecurrence: string | null;
}

export interface PositionedEvent extends CalendarEvent {
	column: number;
	totalColumns: number;
}
