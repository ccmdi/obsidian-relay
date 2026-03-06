export interface MergeResult {
	result: string;
	conflicts: boolean;
}

export function merge3(ancestor: string, local: string, remote: string): MergeResult {
	if (local === remote) return { result: local, conflicts: false };
	if (ancestor === local) return { result: remote, conflicts: false };
	if (ancestor === remote) return { result: local, conflicts: false };

	const ancestorLines = ancestor.split("\n");
	const localLines = local.split("\n");
	const remoteLines = remote.split("\n");

	const localDiff = diff(ancestorLines, localLines);
	const remoteDiff = diff(ancestorLines, remoteLines);

	const output: string[] = [];
	let conflicts = false;

	let ai = 0, li = 0, ri = 0;
	let ld = 0, rd = 0;

	while (ld < localDiff.length || rd < remoteDiff.length) {
		const lhunk = localDiff[ld];
		const rhunk = remoteDiff[rd];

		if (!lhunk) {
			applyHunk(output, ancestorLines, ai, remoteDiff, rd, ri);
			ai = ancestorLines.length;
			break;
		}
		if (!rhunk) {
			applyHunk(output, ancestorLines, ai, localDiff, ld, li);
			ai = ancestorLines.length;
			break;
		}

		if (lhunk.aStart < rhunk.aStart) {
			// copy unchanged lines before this hunk
			while (ai < lhunk.aStart) { output.push(ancestorLines[ai++]!); ri++; }
			// apply local hunk
			for (const line of lhunk.lines) output.push(line);
			ai = lhunk.aEnd;
			li = lhunk.bEnd;
			ld++;
		} else if (rhunk.aStart < lhunk.aStart) {
			while (ai < rhunk.aStart) { output.push(ancestorLines[ai++]!); li++; }
			for (const line of rhunk.lines) output.push(line);
			ai = rhunk.aEnd;
			ri = rhunk.bEnd;
			rd++;
		} else {
			// overlapping or same position
			while (ai < lhunk.aStart) { output.push(ancestorLines[ai++]!); }

			if (arrEqual(lhunk.lines, rhunk.lines)) {
				for (const line of lhunk.lines) output.push(line);
			} else {
				conflicts = true;
				output.push("<<<<<<< LOCAL");
				for (const line of lhunk.lines) output.push(line);
				output.push("=======");
				for (const line of rhunk.lines) output.push(line);
				output.push(">>>>>>> REMOTE");
			}

			ai = Math.max(lhunk.aEnd, rhunk.aEnd);
			li = lhunk.bEnd;
			ri = rhunk.bEnd;
			ld++;
			rd++;
		}
	}

	// remaining unchanged tail
	while (ai < ancestorLines.length) output.push(ancestorLines[ai++]!);

	return { result: output.join("\n"), conflicts };
}

function applyHunk(
	output: string[], ancestor: string[],
	ai: number, hunks: Hunk[], hi: number, _si: number,
): void {
	for (let i = hi; i < hunks.length; i++) {
		const h = hunks[i]!;
		while (ai < h.aStart) output.push(ancestor[ai++]!);
		for (const line of h.lines) output.push(line);
		ai = h.aEnd;
	}
	while (ai < ancestor.length) output.push(ancestor[ai++]!);
}

interface Hunk {
	aStart: number; // start index in ancestor (inclusive)
	aEnd: number;   // end index in ancestor (exclusive)
	bEnd: number;   // end index in modified (exclusive)
	lines: string[]; // replacement lines
}

function diff(a: string[], b: string[]): Hunk[] {
	const lcs = computeLCS(a, b);
	const hunks: Hunk[] = [];

	let ai = 0, bi = 0;
	for (const [la, lb] of lcs) {
		if (ai < la || bi < lb) {
			hunks.push({
				aStart: ai,
				aEnd: la,
				bEnd: lb,
				lines: b.slice(bi, lb),
			});
		}
		ai = la + 1;
		bi = lb + 1;
	}

	if (ai < a.length || bi < b.length) {
		hunks.push({
			aStart: ai,
			aEnd: a.length,
			bEnd: b.length,
			lines: b.slice(bi),
		});
	}

	return hunks;
}

// Returns array of [indexInA, indexInB] pairs for matching lines
function computeLCS(a: string[], b: string[]): [number, number][] {
	const m = a.length, n = b.length;

	// Optimize: build index of b values for faster matching
	const bIndex = new Map<string, number[]>();
	for (let j = 0; j < n; j++) {
		const key = b[j]!;
		let arr = bIndex.get(key);
		if (!arr) { arr = []; bIndex.set(key, arr); }
		arr.push(j);
	}

	// Hunt-Szymanski inspired: for each line in a, find matches in b
	// and build LCS using patience-sort-like approach
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i]![j] = dp[i - 1]![j - 1]! + 1;
			} else {
				dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
			}
		}
	}

	// Backtrack
	const result: [number, number][] = [];
	let i = m, j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			result.push([i - 1, j - 1]);
			i--; j--;
		} else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
			i--;
		} else {
			j--;
		}
	}

	return result.reverse();
}

function arrEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
