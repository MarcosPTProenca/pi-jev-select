/**
 * Budget-feasible line selection from per-line knowledge-type distributions.
 *
 * Faithful TypeScript port of the JevSelect method
 * (`src/tom/context/budgeted.py` in the "Select, Don't Generate" paper):
 * rank lines by argmax type tier (constraint < procedure < belief < preference
 * < episodic), then by descending P(constraint), then document order; fill the
 * character budget greedily, skipping lines that do not fit; emit the chosen
 * lines in document order. The output is always within budget by construction.
 */

export type TypeName = "constraint" | "procedure" | "belief" | "preference" | "episodic";
export type Distribution = Partial<Record<TypeName, number>>;

const TIER: Record<string, number> = {
	constraint: 0,
	procedure: 1,
	belief: 2,
	preference: 3,
	episodic: 4,
};

function argmax(dist: Distribution): string {
	let best = "belief";
	let bestP = -Infinity;
	for (const [k, v] of Object.entries(dist)) {
		if ((v ?? 0) > bestP) {
			bestP = v ?? 0;
			best = k;
		}
	}
	return best;
}

/**
 * Select whole lines whose joined length (with newlines) is <= charBudget.
 * Priority tuple per line i: (tier(argmax p_i), -p_i(constraint), i).
 */
export function selectLines(
	lines: string[],
	distributions: Distribution[],
	charBudget: number,
): string {
	if (lines.length !== distributions.length) {
		throw new Error("one distribution per line is required");
	}
	const order = lines.map((_, i) => i).sort((a, b) => {
		const da = distributions[a];
		const db = distributions[b];
		const ta = TIER[argmax(da)] ?? 2;
		const tb = TIER[argmax(db)] ?? 2;
		if (ta !== tb) return ta - tb;
		const ca = da.constraint ?? 0;
		const cb = db.constraint ?? 0;
		if (cb !== ca) return cb - ca; // descending P(constraint)
		return a - b; // document order
	});

	const chosen: number[] = [];
	let used = 0;
	for (const i of order) {
		const cost = lines[i].length + (chosen.length > 0 ? 1 : 0);
		if (used + cost <= charBudget) {
			chosen.push(i);
			used += cost;
		}
	}
	chosen.sort((a, b) => a - b);
	return chosen.map((i) => lines[i]).join("\n");
}
