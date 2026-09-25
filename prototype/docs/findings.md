# Findings

What the live runs established, in the order they were measured. Each section
records the model version and date it was measured against.

- [What the live runs established](#what-the-live-runs-established) — 19 Sep 2026
- [What the five added scenarios established](#what-the-five-added-scenarios-established) — 22 Sep 2026
- [Closing the coverage gap — six more operations](#closing-the-coverage-gap--six-more-operations) — 23 Sep 2026
- [Retuning the scenarios for a demo](#retuning-the-scenarios-for-a-demo) — 24 Sep 2026

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

## Retuning the scenarios for a demo

Measured 24 Sep 2026 against `jev-1.13.0`. All ten scenarios ran live three
times; every request returned 100% of answers (22–35 questions, 139–410 ms). The
previous nine are preserved in `fixtures/baseline-v3/`. The rubric edits were
measured first on the five scenarios whose data did not change, so their effect
is not confused with the effect of the new data.

**Materiality learned about tracking.** Adding "how results are tracked or
attributed" to the material criterion moved `crm.campaign_ref` `.46 → .77`,
`map.program_id` `.73 → .85` and `goals.attribution_model` `.84 → .96`. The noise
rows did not move (`.04–.08`), and neither did the preheader casing. It did
*not* fix UTM casing: `utm.content` `variant_a → Variant_A` went only
`.14 → .36` while `regenerate_utm` stayed at `.88`. That edit was removed from
`creative`, where it pulled attention from the copy. `utm.campaign` in
`audience` went `.29 → .52–.56`, still below the gate.

**A per-edit claim question beats a keyword filter in both directions.** See the
claims table in [scenarios.md](scenarios.md#the-four-things-worth-seeing-in-detail).
The first decoy, "no guarantees, just what worked", read `.38`, because "what
worked" leans toward a result. "No guarantees, no hype" reads `.15`. Global
`claim_risk` stays at `.98`: it can say *that* a claim appeared, not which edit
made it.

**`unverified_signoff` is the relational question the self-approval wanted.**
`.87` on `budget`, and `.72–.75` on `guardrail`, where it catches the review
date moved forward with no review, which per-field materiality grades `.25`.
Everywhere else it reads `≤ .15`. Its side effect on `budget` is the more
interesting finding: once the record *says* finance approved, `finance_approval`
drops from `.95` to `.47–.52`. The self-signed record talks the operation down.
`interpret.ts` now names that gap: an unverified sign-off with no gating
operation Required is flagged "re-raise it manually".

**Identity is one-to-one, and Jev does not know that.** The new 07:30 window
resolved to "new" in one run of three, and to Friday's old slot (index 3) at
`.50–.52` in the other two, a near coin flip against "new", while Friday
itself held index 3 at `.98–.99`.
Each identity question is answered without seeing the others, so nothing stops
two elements claiming one predecessor. `interpret.ts` now enforces the
constraint: the stronger claim keeps the slot, the weaker falls back to its
best free option ("new" is always free), and a flag says the rule was applied
in code. With it, all three runs resolve the same way.

**The live pair needed a different edit.** The first cut dropped
`seg_active_opportunity` from the exclusions. `safe_while_live` flipped
(`.73 → .29`), but `halt_delivery` reached only `.58`: Jev did not read "mail to
open-deal contacts" as uncorrectable. A timezone move flips wider (`.75 → .21`),
and `halt_delivery` clears review at `.65–.68` across runs. It still does not
reach Required, and its rubric's "cannot be corrected afterwards" is the likely
ceiling.

**`theme` needed an option, not calibration.** With `delivery` added, `channel`
answers it at `1.00` (it was `creative` at `.97`). No other scenario moved.

**The readings strip now applies the uncertainty band to every yes/no tile.**
`budget`'s `invalidates_approval` ran `.54 / .46 / .57`, which printed "yes",
then "no", then "yes". It now reads "unclear", as `safe_while_live`
already did.

**What still straddles a gate between runs:** `rebaseline_reporting` on
`audience` (`.80–.85`, review vs Required), `crm_sync` on `audience`
(`.56–.59`, just under review) and `invalidate_gdpr` on `guardrail`
(`.48–.59`). None of them is a headline reading.
