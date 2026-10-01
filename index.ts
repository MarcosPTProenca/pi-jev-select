/**
 * pi-jev-select: budget-feasible rule retention for Pi compaction.
 *
 * Instead of letting an LLM summarize the context (which drops safety rules at
 * the same rate as prose -- the "compaction cliff"), this extension classifies
 * each line of the span being compacted with Jev (a non-generative structured
 * decision model) and keeps the highest-priority lines VERBATIM within the
 * token budget. Rules survive because they are selected, never rewritten.
 *
 * Method: "Select, Don't Generate" (Proença, 2026). The extension applies the
 * paper's JevSelect selector to Pi's `session_before_compact` hook.
 *
 * Config via environment:
 *   TYPESAFE_API_KEY        required for Jev classification (else falls back to
 *                           Pi's default LLM compaction, non-blocking).
 *   PI_JEV_MODEL            Jev model id (default: jev-1.13.0).
 *   PI_JEV_CONCURRENCY      parallel Jev calls (default: 8).
 *   PI_JEV_RESERVE_RATIO    fraction of tokensBefore kept as the budget
 *                           (default: 0.5, matching the paper's 50% setting).
 *   PI_JEV_TIMEOUT_MS       per-call Jev timeout (default: 20000).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { selectLines, type Distribution } from "./select.ts";
import { createJevClassifier, type JevClassifier } from "./jev.ts";

const MODEL = process.env.PI_JEV_MODEL ?? "jev-1.13.0";
const CONCURRENCY = Number(process.env.PI_JEV_CONCURRENCY ?? 8);
const RESERVE_RATIO = Number(process.env.PI_JEV_RESERVE_RATIO ?? 0.5);
const TIMEOUT_MS = Number(process.env.PI_JEV_TIMEOUT_MS ?? 20000);
// Paper's scoring heuristic: ~4 characters per token.
const CHARS_PER_TOKEN = 4;
// Skip very short, structural lines (headings, fences) as the reference cleaner does.
const MIN_WORDS = 3;

function cleanLines(text: string): string[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => {
			if (!l) return false;
			if (/^#{1,6}\s/.test(l) || /^```/.test(l)) return false;
			return l.split(/\s+/).length >= MIN_WORDS;
		});
}

export default function piJevSelect(pi: ExtensionAPI) {
	let classifier: JevClassifier | undefined;

	function getClassifier(): JevClassifier {
		if (!classifier) {
			classifier = createJevClassifier({
				model: MODEL,
				concurrency: CONCURRENCY,
				timeoutMs: TIMEOUT_MS,
			});
		}
		return classifier;
	}

	pi.on("session_before_compact", async (event, ctx) => {
		if (!process.env.TYPESAFE_API_KEY) return; // fall through to default LLM compaction

		const { convertToLlm, serializeConversation } = await import("@earendil-works/pi-coding-agent");
		const { preparation, signal } = event;

		try {
			const text = serializeConversation(convertToLlm(preparation.messagesToSummarize));
			const lines = cleanLines(text);
			if (lines.length === 0) return; // nothing to select; let Pi summarize

			const budgetTokens = Math.max(64, Math.floor(preparation.tokensBefore * RESERVE_RATIO));
			const charBudget = budgetTokens * CHARS_PER_TOKEN;

			const distributions: Distribution[] = await getClassifier().classify(lines, signal);
			const kept = selectLines(lines, distributions, charBudget);
			if (!kept.trim()) return;

			const u = getClassifier().usage;
			const summary = [
				"## Retained rules and context (JevSelect, verbatim)",
				"",
				"The following lines were selected by per-line knowledge-type probability",
				"and kept verbatim within the context budget; lower-priority lines were dropped.",
				"",
				kept,
			].join("\n");

			return {
				compaction: {
					summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					details: {
						method: "jev-select",
						model: MODEL,
						linesConsidered: lines.length,
						budgetTokens,
						jevInputTokens: u.inputTokens,
						jevCalls: u.calls,
					},
				},
			};
		} catch (error) {
			// Never block compaction: on any failure, let Pi's default summarizer run.
			ctx.ui?.notify?.(`pi-jev-select fell back to LLM compaction: ${String(error).slice(0, 160)}`, "warn");
			return;
		}
	});

	pi.registerCommand("jev-select", {
		description: "Show pi-jev-select status and configuration",
		handler: async (_args, ctx) => {
			const key = process.env.TYPESAFE_API_KEY ? "set" : "MISSING (LLM fallback active)";
			ctx.ui.notify(
				`pi-jev-select active · model ${MODEL} · budget ${Math.round(RESERVE_RATIO * 100)}% · TYPESAFE_API_KEY ${key}`,
				"info",
			);
		},
	});
}
