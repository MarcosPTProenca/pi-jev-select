# pi-jev-select

Budget-feasible rule retention for [Pi](https://github.com/earendil-works/pi) context compaction.

When Pi's context overflows, it compacts the conversation — by default, by asking an
LLM to summarize. For agent **configuration** content (binding rules, prohibitions,
commands), summarization is risky: a rule paraphrased or dropped silently stops being
enforceable. Prior work calls this the *compaction cliff* — safety rules are lost at the
same rate as incidental prose.

`pi-jev-select` replaces generative summarization of that span with **selection**. It
classifies each line with [Jev](https://typesafe.ai) — a non-generative structured
decision model — and keeps the highest-priority lines **verbatim** within the token
budget. Rules survive because they are selected, never rewritten, and the output always
fits the budget by construction.

This is the [`JevSelect`](https://arxiv.org/abs/XXXX.XXXXX) method from *"Select, Don't
Generate: Budget-Feasible Rule Retention for Agent Configurations with a Non-Generative
Classifier"* (Proença, 2026), applied to Pi's `session_before_compact` hook. On a
pre-registered benchmark of 60 agent configurations it retained 0.92 / 0.75 / 0.54 of
reference rules at 50 / 25 / 10 % budgets — several times more than direct LLM compaction
(≤ 0.12), with every output within budget.

## How it works

```
context span to compact
  → clean into candidate lines (drop headings, fences, <3-word lines)
  → Jev: one Choice call per line → P(type) over 5 knowledge types
  → rank by (type tier, -P(constraint), position)
  → greedily fill the character budget, keep whole lines
  → emit kept lines verbatim, in document order
```

The selector guarantees `|output| ≤ budget`. A generative baseline instead rewrites the
span and routinely overshoots the budget (median 1.1–7.0×).

## Install

```bash
npm install pi-jev-select
export TYPESAFE_API_KEY="sk-..."   # required for Jev classification
```

Load it as a Pi extension (user or project `extensions/` directory, or `--extension`):

```bash
pi --extension ./node_modules/pi-jev-select/index.ts
```

Or place/symlink the package under `~/.pi/agent/extensions/pi-jev-select/`.

## Behavior

- Triggers on `session_before_compact` (automatic threshold, `/compact`, or overflow recovery).
- **Never blocks compaction.** If `TYPESAFE_API_KEY` is unset, the span is empty, or any
  Jev call fails, the extension returns nothing and Pi's default LLM summarizer runs.
- `/jev-select` prints current status and configuration.

## Configuration (environment)

| Variable | Default | Description |
|---|---|---|
| `TYPESAFE_API_KEY` | — | Required for Jev. Unset → LLM fallback. |
| `PI_JEV_MODEL` | `jev-1.13.0` | Jev model id. |
| `PI_JEV_CONCURRENCY` | `8` | Parallel Jev calls. |
| `PI_JEV_RESERVE_RATIO` | `0.5` | Budget as a fraction of `tokensBefore`. |
| `PI_JEV_TIMEOUT_MS` | `20000` | Per-call Jev timeout. |

## Scope and limits

The method is for **imperative** configuration text (rules, commands), where it is strong.
It is weak on **declarative** prose (e.g. clinical/legal/financial statements): the paper
reports 32 % recall on declaratively phrased rules and no advantage over chance on a
medical-safety benchmark. It **selects but never rewrites**, so it cannot shorten a single
over-long rule, and it counts rules without weighting severity. Use a dedicated safety
classifier alongside it in sensitive domains.

## Development

```bash
npm test        # self-check of the selector (budget guarantee, ordering)
npm run typecheck
```

## License

MIT © Marcos de Pinho Tavares Proença
