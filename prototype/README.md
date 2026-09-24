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

1. **Revision** — pick one of the nine presets.
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
deno task scenarios            # run all nine live, record fixtures/
deno task scenarios -- creative   # just one, or several by id
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
the pre-rubric-fix run and `fixtures/baseline-v2/` the eight-operation run, both
for comparison.

`deno task shoot` needs the dev server already listening, and assumes Edge at
its default install path (`--browser` to override).

---

## The nine scenarios

The first four are the original set. The last five were added to cover axes none
of them reached.

| Scenario | Changes | What it proves |
|---|---|---|
| **Budget reallocation** | 10 | Materiality grading — every change is real, none are equal |
| **Creative copy edits** | 5 | Semantic judgement. Two subject edits are *structurally identical*. One is a reword; the other adds "guaranteed 3x ROI". Nothing in the JSON says which |
| **Send window shifted** | 8 | Array-element identity. `send_windows` has no ids, so dropping one entry makes the index-matched differ report 8 edits for what is really 1 removal + 1 edit |
| **Audience → DE/FR** | 4 | Cross-field consistency. `compliance.restricted_regions` still blocks DE and FR, but compliance is *unchanged* — so the conflict appears nowhere in the diff |
| **Cosmetic churn** | 4 | The negative case. Reordering `allocations` (keyed) yields **zero** rows; reordering `exclusions` and `industries` (unkeyed primitives) yields two false ones. Materiality must collapse — it does, `.04–.08` |
| **Channel disabled** | 4 | Diff size ≠ consequence. `enabled: true → false` is the smallest edit reportable and grades `.97`, top of the scenario. `landing.ab_test` is left 50/50 against a variant that no longer exists |
| **Integration re-pointing** | 6 | Reach without visibility. Nothing customer-facing, every change re-points an external system. The row graded *lowest* (`.42`) is the new Salesforce ref — the one aiming the campaign at a different record |
| **Launched early** | 7 | The only revision that is actually delivering, so the only one where `safe_while_live` has a true answer (`.26`, decisive). It also self-approves finance, and `approvals[finance].by` grades `.22` |
| **Guardrail loosened** | 4 | Editing the rule instead of the thing it governs. `consent_conflict` correctly goes quiet — after this revision there is no conflict left — and only `invalidates_approval` (`.77`) catches it |

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

Roughly 24–31 questions per request, in three groups:

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

---

## What the five added scenarios established

Measured 22 Sep 2026 against `jev-1.13.0`. All five returned 100% of answers
(18–21 questions each, 160–320 ms). The original four fixtures were left
untouched, so `--diff` still baselines against them.

**`blast_radius` does discriminate — the original four just all sat in one
band.** The standing complaint was that it returned `external_platforms` in
every scenario, and the harness cross-check called the rubric non-discriminating.
Across nine it returns three distinct options and the check goes green:
`noise → none` (`.70`, runner-up `.16`), `guardrail → downstream_consumers`,
and the rest `external_platforms`. The ordinal-ladder rewrite worked; what was
missing was a revision whose correct answer was *not* at the far end. Note this
narrows open item 2 rather than closing it — five of nine still answer
`external_platforms`, and the derived value still disagrees with the asked one
five times out of nine.

**The self-approval is invisible to per-field materiality.** In `launch`,
`approvals[finance].status` (`pending → approved`) grades `.83`, but
`approvals[finance].by` (`null → u_221`) grades `.22` — bookkeeping. `u_221` is
the campaign owner and the same user as `updated_by`: the signer *is* the
requester, which is the only genuinely alarming fact in the revision. No single
field can carry it, so no per-change question can ask about it. This is a
structural limit of one-question-per-change, not a calibration problem, and it
wants a relational question of its own.

**The negative control is not fully dark, for a defensible reason.** Every
change in `noise` grades `.04–.08`, exactly as it should. But `crm_sync` still
clears the review gate at `.73`, because the campaign was renamed and its
description says "needed when names … change". That is arguably right — the CRM
does hold the name. The harness check for this pattern only looked at the
*Required* bucket and therefore missed it; it now looks at any cleared gate, and
reports `noise: no change graded material, yet crm_sync 0.73 cleared a gate`.

**The operations catalogue had a hole — now closed.** `channel` disables an
entire paid channel and `integration` swaps the LinkedIn ad account, and in both
cases `op__resync_ad_budgets` came back at `.10`. Consistent with its rubric —
that description is written about spend figures and pacing, and neither changed
— but there was no operation for pushing *delivery configuration* to a platform,
so the most consequential change in `channel` mapped to nothing. Six operations
were added to cover that and five similar gaps; see below.

**A loosened guardrail clears no gate at all.** In `guardrail`, nothing reaches
even the review threshold — `invalidate_gdpr` tops out at `.45` — while
`invalidates_approval` reads `.77` and the derived blast radius is `none`. The
readout would be empty if it were driven by the operation gates alone. The
global readings are what catch it, which is the argument for keeping both.

**`safe_while_live` now has a live case, and it answers it.** `.26` on `launch`
— decisively negative, correctly flagged as "halt or re-gate before applying".
Against the `scheduled` scenarios it spreads `.20–.86`. The premise text is now
branched on status, because the original wording asserted "not delivering yet —
no sends, no impressions, nothing in flight", which a `live` campaign makes
false. The `scheduled` branch is kept byte-for-byte so the fixtures stay
comparable.

**Two readings sit in the middle and are honest about it.** `integration` at
`.48` and `guardrail` at `.49` on `safe_while_live`, both caught by
`UNCERTAIN_BAND` and reported as unanswered rather than rounded. Across nine,
`safe_while_live` and `invalidates_approval` are each 5/9 decisive.

**`theme` is capped by its option count, not by its calibration.** Seven
distinct labels across nine scenarios, min confidence `.60`. `channel` returns
`creative` (`.97`) — there is no channel- or delivery-config option to return —
and `launch` returns `schedule` at `.60`, its lowest confidence anywhere, which
is the right answer for a revision that is genuinely three things at once. The
cross-check was rewritten accordingly: it no longer demands all-distinct (which
was only achievable at four), and instead fails when one label claims more than
half the set.

---

## Closing the coverage gap — six more operations

Measured 23 Sep 2026 against `jev-1.13.0`. The catalogue went from 8 to 14, so
requests are now 24–31 questions. All nine scenarios returned 100% of answers at
113–356 ms. The previous fixtures are preserved in `fixtures/baseline-v2/`.

| Added operation | Reach | Fires on | Stays dark elsewhere |
|---|---|---|---|
| `push_channel_config` | external | `channel` `.97`, `integration` `.88` | `.08–.21` |
| `reprogram_send_schedule` | external | `schedule` `.97`, `launch` `.95` | `.06–.11` |
| `repush_creative_set` | external | `channel` `.92` | `.06–.08` |
| `rebaseline_reporting` | downstream | `integration` `.98`, `audience` `.84` | `.09–.18` |
| `update_retention_policy` | downstream | `guardrail` `.92` | `.06–.09` |
| `halt_delivery` | external | — nothing, see below | `.06–.21` |

**The exclusion clauses are what made them discriminate.** Each description is
*what it does* + "Needed when…" + an explicit exclusion, and the exclusions are
doing visible work:

- `repush_creative_set` excludes "an edit to the wording inside a variant that is
  already in rotation". `creative` — five copy edits — scores it `.07`. `channel`,
  which deletes a variant and re-weights the other, scores it `.92`. Without that
  clause it would have fired on every creative scenario.
- `rebaseline_reporting` excludes "target numbers move while the way they are
  measured stays the same". `budget` moves all three targets and scores `.09`;
  `integration` switches the attribution model and scores `.98`.
- `push_channel_config` excludes spend figures and pacing, deferring to
  `resync_ad_budgets`. On `budget` it reads `.12` while `resync_ad_budgets`
  reads `.97` — the two do not overlap.

**Every scenario now has at least one Required operation except `noise`**, which
is the correct outcome for a revision that is entirely cosmetic. `guardrail`
went from *nothing clearing any gate* to `update_retention_policy` at `.92`.

**`halt_delivery` is the one that cannot be exercised here, and that is a
property of the fixture, not the rubric.** It tops out at `.21` on `launch` and
sits `.06–.10` everywhere else. That is correct: `BEFORE` is `scheduled` in every
scenario, so no revision edits a campaign that was *already* delivering — and you
do not halt a campaign in order to start it. Note this means a low
`safe_while_live` does **not** imply `halt_delivery`: that question's false
criterion is a disjunction ("disrupt delivery already underway, **or** put the
campaign outside an approval"), and on `launch` it is the approval half that
fires. Exercising the halt path properly needs a second `BEFORE` with
`status: "live"`, which is a larger change than adding a scenario.

**Adding external-reach operations made the derived blast radius coarser and
more accurate at the same time.** It now reads `external_platforms` in seven of
nine (was four) and agrees with the asked `blast_radius` seven times out of nine
(was four). Two distinct values instead of three — but the moves are all
defensible: `schedule` became external because the send calendar genuinely lives
at the email provider, and `guardrail` went from `none` to `downstream` because
retention genuinely touches stored records. The old spread came partly from
blind spots.

**Existing answers moved more than the stated ±0.01 in the mid-range.**
`crm_sync` on `creative` went `.24 → .16` and on `launch` `.52 → .47`, with
`legal_recheck` on `audience` `.24 → .19`. State is byte-identical and questions
cannot see each other, so this is run-to-run variance — it is just larger where
the distribution is flat than the `±0.01` the bimodal answers show. Treat `±0.01`
as the figure for decisive answers only.

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
