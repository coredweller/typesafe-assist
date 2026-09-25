# How it works

The pipeline, the shape of the request sent to Jev, and how answers become
operations.

## The pipeline

| Stage | Where | File |
|---|---|---|
| 1. Pick or edit the After campaign | browser | `src/scenarios.ts` |
| 2. Deterministic diff | browser | `src/diff.ts` |
| 3. Build the question set | browser | `src/questions.ts` |
| 4. `POST /v1/systemone` | Deno proxy | `server.ts` |
| 5. Thresholds → operations | browser | `src/interpret.ts` |

Only stage 4 crosses the network, and `state` is sent **once** for all
questions, so the fan-out amortises it.

The API key is read by `server.ts` on the Deno side and attached to the upstream
request there. It never reaches the browser — verified:
`curl localhost:8787/app.js | grep TYPESAFE_API_KEY` returns nothing.

## Question shape

22–35 questions per request, in four groups:

- `material__<i>` — one `noul` per change. The key encodes the change index so
  answers zip back to changes, the same trick as `entity__light` in
  `custom_components/typesafe_conversation/questions.py`.
- `identity__<i>` — a `choice` per element of a position-matched array, asking
  which previous element it corresponds to. Only emitted when the diff actually
  fell back to index matching. This is the one question that genuinely needs
  both `before` and `after` in the state.
- `claim__<i>` — one `noul` per change to a copy field (`subject`, `preheader`,
  `headline`), asking whether *that* edit introduces a claim. Only emitted when
  copy changed.
- Global readings (`theme`, `blast_radius`, `safe_while_live`,
  `invalidates_approval`, `unverified_signoff`, `consent_conflict`,
  `claim_risk`) and one `noul` per candidate operation.

Operations get one question **each** because the API has no list-valued answer
type — `ChoiceAnswer.choice` is a single string, `noul` and `score` are single
floats. "Which of these apply?" cannot be asked as one question.

## Thresholds

Operations bucket into Required (≥ 0.85), Needs review (≥ 0.60) and Not needed.
Both gates are sliders, and moving them re-buckets off the cached response with
**no second API call** — the calibration argument made tangible.

## Fixtures and baselines

`deno task scenarios` records each run into `fixtures/`. `--replay` re-scores
those recordings with no API calls, so threshold and interpretation changes are
free to iterate on. `--diff` runs live and prints per-answer deltas against the
recorded run, so a rubric change is measured rather than eyeballed.

Older runs are kept for comparison:

- `fixtures/baseline-v1/` — the pre-rubric-fix run
- `fixtures/baseline-v2/` — the eight-operation run
- `fixtures/baseline-v3/` — the last nine-scenario run (including the retired
  `launch`)

`deno task shoot` needs the dev server already listening, and assumes Edge at
its default install path (`--browser` to override).

## Notes

- Operations are a **readout**. Nothing is executed; the endpoints are shown for
  illustration.
- `interpret.ts` enforces cross-question consistency in code, because Jev has no
  knowledge of its own other answers within a request.
- Editing the After JSON regenerates the diff and question set live, and
  invalidates any previous answers.
- `deno bundle` is marked experimental in 2.9.7 and warns on every invocation.
  It works, and it is esbuild-backed, but it may move.
