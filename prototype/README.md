# Jev diff prototype

An interactive page for the pattern this repo's conversation landed on:

> **Don't make Jev do the comparison.** Compute the diff deterministically in
> code, then put it into the `state` *alongside* both object versions.

The structural facts are then guaranteed correct rather than probabilistically
re-derived, every question becomes a pure judgement call, and both the state and
the question count collapse from "every candidate field" to "the things that
actually changed."

The object under test is a marketing campaign — ~10 top-level keys, four levels
deep, with both keyed and unkeyed arrays.

---

## Running it

```bash
cp .env.example .env        # then paste your key into TYPESAFE_API_KEY
deno task dev               # http://localhost:8787
```

Requires Deno 2.4+ (for the built-in `bundle`). Then open
<http://localhost:8787> and press **Ask Jev**.

### Windows notes

Deno was installed with `winget install DenoLand.Deno` and is **not on `PATH`**
in shells that were already open when it was installed. Either open a new
terminal, or prepend it for the session:

```powershell
$env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe;$env:PATH"
```

Two more things that will bite:

- **`AddrInUse` on startup** means a `deno` process from an earlier session is
  still holding `:8787`. That is usually fine — the server re-bundles
  `src/main.ts` on every request to `/app.js`, so a stale process still serves
  current code. Only `.env` is read once, at startup. To restart properly:
  `Get-NetTCPConnection -LocalPort 8787 -State Listen | %{ Stop-Process -Id $_.OwningProcess }`
- **Don't pipe Deno through PowerShell's `2>&1`.** It wraps stderr lines in
  ErrorRecords and reports failure on a successful run. Deno's download chatter
  goes to stderr, so a clean build looks like a build error.

---

## What to look at

The page is six numbered stages, top to bottom, and the whole argument is
visible by comparing stage 3 against stage 5.

1. **Revision** — pick one of the four presets.
2. **Before / After** — the After pane is editable. Type in it and stages 3 and
   4 regenerate as you go.
3. **Computed diff** — produced by `src/diff.ts`. No model involved. Rows in a
   position-matched array are tagged `by index`, meaning identity is a guess.
4. **Request to Jev** — expand it. `state` carries both full versions *and* the
   diff, and is sent **once** for the whole batch.
5. **Answers** — the readings strip, then one bar per question.
6. **Operations** — bucketed by two gates. **Drag the sliders**: it re-buckets
   off the cached response with no second API call.

### The three things worth seeing

**Creative copy edits — semantic judgement.** Two subject-line edits are
*structurally identical*: same `replace` op, same path shape, both
string→string. A byte diff, a JSON Patch and every structural differ rank them
the same. Jev separates them by about 0.65 — the reword lands near `.30`, the
one that adds "guaranteed 3x ROI" near `.95`, with `claim_risk` at `.98`. That
number pair is the entire argument.

**Send window removed & shifted — array identity.** One window is dropped and
the rest shift up. `send_windows` has no ids, so the differ reports **8
changes** across three elements. Scroll to *array element identity*: Jev maps
index 0←1, 1←2, 2←3 at `.95–.99`. Those 8 rows are really 1 removal plus 1 edit.
This is the one question that genuinely needs both versions in the state.

**Audience expansion into DE/FR — cross-field conflict.** Targeting gains DE and
FR; `compliance.restricted_regions` still blocks both. Compliance is
*unchanged*, so it appears **nowhere in the diff** — yet `consent_conflict`
comes back at `.93` and `invalidate_gdpr` clears the Required gate. The conflict
was found in the state, which is why both full versions belong in the payload.

---

## Headless tools

The UI is the demo; these are how the thing is actually tested.

```bash
deno task scenarios            # run all four live, record fixtures/
deno task scenarios -- creative   # just one
deno task scenarios -- --replay   # re-score recorded fixtures, no API calls
deno task scenarios -- --diff     # run live, diffed against the last fixtures
deno task scale                # ramp the change count and watch the batch hold
deno task shoot                # drive the real UI in headless Edge, screenshot
deno task check                # type-check everything
```

`--replay` is the important one: once `fixtures/` exists, threshold and
interpretation changes are free to iterate on. `--diff` is what you run after
editing a rubric — it prints per-answer deltas against the recorded run, so a
rubric change is measured rather than eyeballed. `fixtures/baseline-v1/` holds
the pre-rubric-fix run for comparison.

`deno task shoot` needs the dev server already listening, and assumes Edge at
its default install path (`--browser` to override).

---

## The four scenarios

| Scenario | Changes | What it proves |
|---|---|---|
| **Budget reallocation** | 10 | Materiality grading — every change is real, none are equal |
| **Creative copy edits** | 5 | Semantic judgement. Two subject edits are *structurally identical*. One is a reword; the other adds "guaranteed 3x ROI". Nothing in the JSON says which |
| **Send window shifted** | 8 | Array-element identity. `send_windows` has no ids, so dropping one entry makes the index-matched differ report 8 edits for what is really 1 removal + 1 edit |
| **Audience → DE/FR** | 4 | Cross-field consistency. `compliance.restricted_regions` still blocks DE and FR, but compliance is *unchanged* — so the conflict appears nowhere in the diff |

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

Roughly 18–25 questions per request, in three groups:

- `material__<i>` — one `noul` per change. The key encodes the change index so
  answers zip back to changes, the same trick as `entity__light` in
  `custom_components/typesafe_conversation/questions.py`.
- `identity__<i>` — a `choice` per element of a position-matched array, asking
  which previous element it corresponds to. Only emitted when the diff actually
  fell back to index matching. This is the one question that genuinely needs
  both `before` and `after` in the state.
- Global readings (`theme`, `blast_radius`, `safe_while_live`,
  `invalidates_approval`, `consent_conflict`, `claim_risk`) and one `noul` per
  candidate operation.

Operations get one question **each** because the API has no list-valued answer
type — `ChoiceAnswer.choice` is a single string, `noul` and `score` are single
floats. "Which of these apply?" cannot be asked as one question.

## Thresholds

Operations bucket into Required (≥ 0.85), Needs review (≥ 0.60) and Not needed.
Both gates are sliders, and moving them re-buckets off the cached response with
**no second API call** — the calibration argument made tangible.

---

## What the live runs established

Measured 19 Sep 2026 against `jev-1.13.0` (the `jev-latest` alias).

**Scale is not a constraint.** The worry was that ~20 questions against a large
state might be rejected. It is not close. Ramping synthetic changes:

| Changes | Questions | State | Request (min) | Answered | Latency |
|---:|---:|---:|---:|---:|---:|
| 10 | 24 | 7.3 KB | 18.5 KB | 24/24 | 359 ms |
| 50 | 64 | 12.8 KB | 40.4 KB | 64/64 | 188 ms |
| 150 | 164 | 27.0 KB | 95.6 KB | 164/164 | 308 ms |
| 250 | 264 | 41.3 KB | 151.2 KB | 264/264 | 534 ms |

Every request returned **100% of answers**, and per-question latency *improves*
with batch size (15 ms/question at 24, 2.0 ms/question at 264) because the state
is sent once. There is no need for a two-stage fallback.

**Three numbers get called "payload size" and they disagree.** For the four
scenarios: `state` alone is 6.5–6.8 KB, the minified full request is 14–18 KB,
and the pretty-printed request the UI displays is 22–27 KB. The harness reports
all three so they stop being confused for each other.

**`choice` is not always the argmax of `probabilities`.** On the creative
scenario `blast_radius` returned `choice: "downstream_consumers"` (0.300) while
`this_record` scored 0.310. The options were effectively tied and `confidence`
correctly collapsed to `.13`. Code that reads `choice` alone will occasionally
disagree with the distribution it arrived with — `interpret.ts` flags the
mismatch rather than silently resolving it. **Read the distribution, and gate on
`confidence`.**

**`blast_radius` was asking a multi-select question as a single-select.** It
originally answered `external_platforms` in all four scenarios at `.37–.62`,
because reach is *cumulative* — every level is arguably true at once, so the
broadest option swallowed everything. Rewriting the rubric as a strict ordinal
ladder ("pick the single furthest level; each criterion states its own upper
bound") moved budget from `.57` to `.88` with the runner-up gap widening from
`.36` to `.83`. Where the model is now genuinely torn — schedule sits at
external `.46` / downstream `.39` — it reports low confidence instead of false
certainty, which is the correct failure mode.

It is still the weakest signal in the set, and `interpret.ts` now also
**derives** a blast radius from which operations cleared a gate (each operation
is tagged with the boundary it crosses). The derived value is the more
trustworthy of the two, because the operation gates come back cleanly bimodal
where the single choice does not. Both are shown side by side in the readings
strip so they can be seen disagreeing.

**`safe_while_live` was unanswerable as written.** It asked whether the revision
could be applied "without pausing" — but the campaign's status is `scheduled`,
so nothing is delivering and there is nothing to pause. Answers sat at
`.53/.55/.67/.26`. Spelling out the status and naming the real discriminator
spread them to `.61/.43/.84/.20`, and the half that actually varies pre-launch
was split into its own question, `invalidates_approval`, which behaves well:
`.60/.75/.25/.85`, correctly ranking audience (GDPR review now stale) above
creative (new claim vs. approved copy) above budget (finance was already
pending, so nothing was *invalidated*) above schedule.

**A near-.5 answer was being rendered as a directive.** `interpret.ts` turned
`safe_while_live = .53` into "pause the campaign". Readings within `±0.10` of
`.5` are now reported as *unclear* rather than rounded into a decision.

**Independent answers can disagree, and do.** In the creative scenario
`landing.utm.content` (`variant_a` → `Variant_A`) grades cosmetic at `.15` while
`op__regenerate_utm` fires at `.88`. Both are defensible — UTM values are
case-sensitive to analytics, so a casing change really does break attribution.
Jev has no knowledge of its own other answers within a request, so every
cross-question reconciliation happens in `interpret.ts`.

**What works flawlessly:** `theme` returns the correct category in all four
scenarios at `.99–1.00`. Per-change materiality separates signal from noise
every time. Operation gates are strongly bimodal — relevant at `.88–.97`,
irrelevant at `.05–.25`.

**One genuinely ambiguous case now exists.** In the audience scenario `crm_sync`
lands at `.54–.60` across runs, straddling the review gate. Everything else is
bimodal enough that any gate between `.35` and `.85` sorts it identically, so
this is currently the only case with anything to tune against. Run-to-run
variance is otherwise about `±0.01`.

---

## Notes

- Operations are a **readout**. Nothing is executed; the endpoints are shown for
  illustration.
- `interpret.ts` enforces cross-question consistency in code, because Jev has no
  knowledge of its own other answers within a request.
- Editing the After JSON regenerates the diff and question set live, and
  invalidates any previous answers.
- `deno bundle` is marked experimental in 2.9.7 and warns on every invocation.
  It works, and it is esbuild-backed, but it may move.
