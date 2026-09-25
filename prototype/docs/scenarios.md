# Scenarios

The ten preset revisions, and what each one is meant to show. For how to run
them headless, see the [README](../README.md#headless-tools). For the measured
history behind the numbers, see [findings.md](findings.md).

## The ten scenarios

In demo order, which is also the button order and the screenshot numbering.
Numbers are from the 24 Sep 2026 runs.

| Scenario | Changes | What it proves |
|---|---|---|
| **Claims vs rewording** | 5 | Semantic judgement a keyword filter cannot do: a decoy that says "no guarantees" (`.15`) and a claim with no trigger word (`.97`) |
| **Send windows reshuffled** | 10 | Array-element identity: three entries moved, one new, one removed. Ten index-matched rows, three real edits |
| **Audience → DE/FR** | 4 | Cross-field consistency. `restricted_regions` still blocks DE and FR, but compliance is *unchanged*, so the conflict appears nowhere in the diff |
| **Guardrail loosened** | 4 | Audience run backwards. `consent_conflict` correctly goes quiet; `invalidates_approval` (`.77`) and `unverified_signoff` (`.75`) catch the bypass. The review date moved forward still grades `.25` per field |
| **Timezone moved — scheduled** | 1 | Half of a pair: reprogram the calendar, safe to apply in place (`.75`) |
| **Timezone moved — live** | 1 | The byte-identical diff against a live Before: apply-in-place flips to `.21`, `halt_delivery` clears review at `.66` |
| **Channel disabled** | 4 | Diff size ≠ consequence. `enabled: true → false` is the smallest reportable edit and grades `.97`. `theme` now answers `delivery` |
| **Cosmetic churn** | 4 | The negative control. Every row `.04–.08`; `crm_sync` still clears review off the rename, and the page flags the disagreement |
| **Budget +24%, finance self-approved** | 13 | Fan-out to three Required operations, plus a self-signed approval that per-field grading calls bookkeeping (`.19–.22`) and `unverified_signoff` catches (`.87`) |
| **Integration re-pointing** | 6 | Reach without visibility. `rebaseline_reporting` `.98`; the Salesforce ref went from `.46` to `.77` once materiality learned about tracking |

`launch` was retired. Its self-approval moved into `budget`, and its live status
into the timezone pair, which does the job better: `launch` flipped status and
changed five other things at once, so its theme read `.60` and nothing could
isolate the effect of being live.

## The four things worth seeing, in detail

**Claims vs rewording — semantic judgement.** Four copy edits, all the same
shape: a string replaced by a string. A byte diff, a JSON Patch and every
structural differ rank them the same. Read the *new claim* group, one question
per copy edit:

| Edit | Keyword filter for "guarantee" | Jev `claim__` |
|---|---|---|
| "…in Q4" → "…this quarter" (reword) | clean | `.07` |
| "…rebuilt" → "…rebuilt — guaranteed 3x ROI" | **flags** | `.99` |
| "…enterprise teams" → "…— no guarantees, no hype" (decoy) | **flags** — wrong | `.15` |
| "Enterprise pipeline, predictably" → "The pipeline platform analysts rank first" | clean — wrong | `.97` |

The last two rows are the argument. The ranking claim has no trigger word and no
digit, and materiality alone cannot separate the decoy either: it is a real
meaning change (`.82`), just not a claim.

**Send windows reshuffled — array identity.** The morning window is dropped,
Thursday is pulled in, and a new 07:30 window is appended. `send_windows` has no
ids, so the differ reports **10 changes** across four elements. Scroll to *array
element identity*: index 0←1, 1←2, 2←3 at `.94–.99`, and the fourth resolves as
**new**. Ten rows are really one removal, one edit and one addition. The fourth
answer is the weak one, and the reason is useful: see *Identity is one-to-one*
in [findings.md](findings.md#retuning-the-scenarios-for-a-demo).

**Audience expansion into DE/FR — cross-field conflict.** Targeting gains DE and
FR, and `compliance.restricted_regions` still blocks both. Compliance is
*unchanged*, so it appears **nowhere in the diff**, yet `consent_conflict` comes
back at `.94` and `invalidate_gdpr` clears the Required gate. Jev found the
conflict in the state, which is why both full versions belong in the payload.

**Timezone moved, scheduled vs live — same diff, opposite verdict.** One edit,
New York → Los Angeles, applied to two versions of the campaign. The diff tables
match byte for byte, and materiality grades the row `.93–.95` in both. The
state-dependent answers flip: `safe_while_live` goes `.75 → .21`, and
`halt_delivery`, dark in every other scenario, goes `.09 → .66`.
