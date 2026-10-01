/**
 * Jev line classifier: one non-generative `Choice` call per line, returning a
 * probability distribution over the five knowledge types. Faithful port of the
 * `type_distribution` path in `src/tom/providers/jev.py` using the official
 * `@typesafe-ai/sdk`. Jev never generates text; it evaluates typed questions.
 */

import type { Distribution, TypeName } from "./select.ts";

const KNOWLEDGE_TYPE_CRITERIA: Record<TypeName, string> = {
	constraint: "A rule, requirement, prohibition, or limit on future actions.",
	procedure: "A sequence of steps or instructions for how to do something.",
	belief: "A factual claim about the world the agent should hold as true.",
	preference: "A user or system preference about how things should be done.",
	episodic: "A record of a specific event or interaction that occurred.",
};

export interface JevUsage {
	inputTokens: number;
	outputTokens: number;
	calls: number;
}

export interface JevClassifier {
	classify(lines: string[], signal?: AbortSignal): Promise<Distribution[]>;
	readonly usage: JevUsage;
}

/**
 * Lazily constructs an `@typesafe-ai/sdk` client (reads TYPESAFE_API_KEY) and
 * classifies each line in parallel. `concurrency` caps simultaneous requests so
 * a large config does not open hundreds of sockets at once.
 */
export function createJevClassifier(opts: {
	model?: string;
	concurrency?: number;
	timeoutMs?: number;
} = {}): JevClassifier {
	const concurrency = Math.max(1, opts.concurrency ?? 8);
	const usage: JevUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
	let clientPromise: Promise<any> | undefined;

	async function getClient(): Promise<any> {
		if (!clientPromise) {
			clientPromise = import("@typesafe-ai/sdk").then((sdk) => {
				const cfg: Record<string, unknown> = {};
				if (opts.model) cfg.defaultModel = opts.model;
				if (opts.timeoutMs) cfg.timeout = opts.timeoutMs;
				return new sdk.TypeSafeClient(cfg);
			});
		}
		return clientPromise;
	}

	async function classifyOne(client: any, line: string, signal?: AbortSignal): Promise<Distribution> {
		const sdk = await import("@typesafe-ai/sdk");
		const question = sdk.choice(
			"What kind of knowledge does this information represent?",
			KNOWLEDGE_TYPE_CRITERIA,
		);
		const { answers, usage: u } = await client.systemOne(
			{ state: line, questions: { knowledge_type: question } },
			signal ? { signal } : undefined,
		);
		usage.inputTokens += u?.input_tokens ?? 0;
		usage.outputTokens += u?.output_tokens ?? 0;
		usage.calls += 1;
		const ans = answers.knowledge_type;
		const probs = (ans.probabilities ?? {}) as Distribution;
		return Object.keys(probs).length ? probs : ({ [ans.choice]: 1.0 } as Distribution);
	}

	async function classify(lines: string[], signal?: AbortSignal): Promise<Distribution[]> {
		const client = await getClient();
		const out: Distribution[] = new Array(lines.length);
		let next = 0;
		async function worker(): Promise<void> {
			while (next < lines.length) {
				const i = next++;
				out[i] = await classifyOne(client, lines[i], signal);
			}
		}
		await Promise.all(Array.from({ length: Math.min(concurrency, lines.length) }, worker));
		return out;
	}

	return { classify, usage };
}
