import { App, TFile } from "obsidian";

/**
 * Query syntax:
 * - "*" - all files
 * - "folder" - files directly in folder
 * - "folder/*" - files in folder and subfolders
 * - "#tag" - files with tag
 * - "folder/* or #tag" - OR
 * - "folder/* and #tag" - AND
 * - "folder/* not #draft" - exclusion
 *
 * Precedence (highest to lowest): NOT, AND, OR
 */

export interface QueryCondition {
	type: "all" | "folder" | "folder_recursive" | "tag";
	value: string;
}

export interface QuerySegment {
	andConditions: QueryCondition[];
	notConditions: QueryCondition[];
}

function parseTerm(term: string): QueryCondition | null {
	const trimmed = term.trim();
	if (!trimmed) return null;

	if (trimmed === "*") {
		return { type: "all", value: "*" };
	} else if (trimmed.startsWith("#")) {
		return { type: "tag", value: trimmed.substring(1) };
	} else if (trimmed.endsWith("/*")) {
		return { type: "folder_recursive", value: trimmed.slice(0, -2).replace(/\/$/, "") };
	} else {
		return { type: "folder", value: trimmed.replace(/\/$/, "") };
	}
}

export function parseQuerySegments(query: string): QuerySegment[] {
	const segments: QuerySegment[] = [];
	const orParts = query.split(/\s+or\s+/i);

	for (const orPart of orParts) {
		const trimmed = orPart.trim();
		if (!trimmed) continue;

		const segment: QuerySegment = {
			andConditions: [],
			notConditions: [],
		};

		const notParts = trimmed.split(/\s+not\s+/i);

		const andPart = notParts[0];
		if (andPart) {
			for (const term of andPart.split(/\s+and\s+/i)) {
				const condition = parseTerm(term);
				if (condition) segment.andConditions.push(condition);
			}
		}

		for (let i = 1; i < notParts.length; i++) {
			const notPart = notParts[i];
			if (!notPart) continue;
			for (const term of notPart.split(/\s+and\s+/i)) {
				const condition = parseTerm(term);
				if (condition) segment.notConditions.push(condition);
			}
		}

		if (segment.andConditions.length > 0) {
			segments.push(segment);
		}
	}

	return segments;
}

export function validateQuery(query: string): { valid: boolean; error?: string } {
	const trimmed = query.trim();
	if (!trimmed) return { valid: false, error: "Query cannot be empty" };

	const segments = parseQuerySegments(trimmed);
	if (segments.length === 0) {
		return { valid: false, error: "Query must contain at least one condition (folder, folder/*, #tag, or *)" };
	}

	for (const segment of segments) {
		if (segment.andConditions.length === 0) {
			return { valid: false, error: "Each OR branch must have at least one positive condition" };
		}
	}

	return { valid: true };
}

export function fileMatchesQuery(app: App, file: TFile, query: string): boolean {
	const segments = parseQuerySegments(query);
	for (const segment of segments) {
		if (fileMatchesSegment(app, file, segment)) return true;
	}
	return false;
}

function fileMatchesSegment(app: App, file: TFile, segment: QuerySegment): boolean {
	for (const condition of segment.andConditions) {
		if (!matchCondition(app, file, condition)) return false;
	}
	for (const condition of segment.notConditions) {
		if (matchCondition(app, file, condition)) return false;
	}
	return true;
}

function matchCondition(app: App, file: TFile, condition: QueryCondition): boolean {
	switch (condition.type) {
		case "all": return true;
		case "folder": return matchFolder(file, condition.value, false);
		case "folder_recursive": return matchFolder(file, condition.value, true);
		case "tag": return matchTag(app, file, condition.value);
		default: return false;
	}
}

function matchFolder(file: TFile, folder: string, recursive: boolean): boolean {
	const normalizedFolder = folder.replace(/\\/g, "/");
	const filePath = file.path.replace(/\\/g, "/");

	if (recursive) {
		return filePath.startsWith(normalizedFolder + "/");
	} else {
		const fileDir = file.parent?.path.replace(/\\/g, "/") || "";
		return fileDir === normalizedFolder;
	}
}

export function extractFirstTag(query: string): string | null {
	const segments = parseQuerySegments(query);
	for (const seg of segments) {
		for (const cond of seg.andConditions) {
			if (cond.type === "tag") return cond.value;
		}
	}
	return null;
}

function matchTag(app: App, file: TFile, tag: string): boolean {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return false;

	const frontmatterTags = cache.frontmatter?.tags as string | string[] | undefined;
	if (frontmatterTags) {
		const tagsArray = Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags];
		for (const t of tagsArray) {
			const normalized = String(t).replace(/^#/, "");
			if (normalized === tag || normalized.startsWith(tag + "/")) return true;
		}
	}

	if (cache.tags) {
		for (const tagCache of cache.tags) {
			const normalized = tagCache.tag.replace(/^#/, "");
			if (normalized === tag || normalized.startsWith(tag + "/")) return true;
		}
	}

	return false;
}
