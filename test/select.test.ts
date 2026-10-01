/**
 * Self-check for the JevSelect selector. Run: node --experimental-strip-types test/select.test.ts
 * Asserts the budget guarantee, the tier/probability ordering and document-order output.
 */

import assert from "node:assert";
import { selectLines, type Distribution } from "../select.ts";

function c(p: number): Distribution {
	return { constraint: p, belief: 1 - p };
}

// 1. Output never exceeds the character budget.
{
	const lines = ["never force-push to main", "run tests before a PR", "we use react 18", "prefer small commits"];
	const dists: Distribution[] = [c(0.94), { procedure: 0.71, belief: 0.29 }, c(0.37), { preference: 0.55, belief: 0.45 }];
	for (const budget of [0, 10, 25, 50, 100, 1000]) {
		const out = selectLines(lines, dists, budget);
		assert.ok(out.length <= budget, `budget ${budget}: got ${out.length} chars`);
	}
}

// 2. Constraints are preferred over non-constraints when both fit only one.
{
	const lines = ["this is a belief line here", "NEVER delete prod data"];
	const dists: Distribution[] = [c(0.1), c(0.95)];
	// budget fits exactly one line (the longer belief is 26 chars, constraint is 22)
	const out = selectLines(lines, dists, 22);
	assert.strictEqual(out, "NEVER delete prod data", "constraint must win the single slot");
}

// 3. Kept lines are emitted in document order, not priority order.
{
	const lines = ["aaa low belief", "bbb HIGH constraint"];
	const dists: Distribution[] = [c(0.1), c(0.9)];
	const out = selectLines(lines, dists, 1000);
	assert.strictEqual(out, "aaa low belief\nbbb HIGH constraint", "document order on output");
}

// 4. Tier beats probability: a procedure outranks a lower-tier belief even with lower p(constraint).
{
	const lines = ["x", "y"];
	const dists: Distribution[] = [{ belief: 0.9, constraint: 0.4 }, { procedure: 0.9, constraint: 0.1 }];
	const out = selectLines(lines, dists, 1); // only one 1-char line fits
	assert.strictEqual(out, "y", "procedure (tier 1) must outrank belief (tier 2)");
}

// 5. Mismatched lengths throw.
assert.throws(() => selectLines(["a"], [], 10), /one distribution per line/);

console.log("select.test.ts: all assertions passed");
