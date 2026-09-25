# Jev diff prototype

An interactive page that tests one idea:

> **Don't make Jev do the comparison.** Compute the diff in code, then send it
> to Jev *alongside* both versions of the object.

Code gets the structural facts right every time, so Jev only has to answer
judgement calls: does this edit matter, is this a new claim, is it safe while
the campaign is live? Jev only gets asked about fields that actually changed,
not every field on the object.

The test object is a marketing campaign: about 10 top-level keys, four levels
deep, with both keyed and unkeyed arrays.

## Running it

```bash
cp .env.example .env        # then paste your key into TYPESAFE_API_KEY
deno task dev               # http://localhost:8787
```

Requires Deno 2.4+. Open <http://localhost:8787> and press **Ask Jev**.

**On Windows:**

- If `deno` isn't found, open a new terminal (it was installed via winget and
  older shells don't have it on `PATH`), or run:
  ```powershell
  $env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe;$env:PATH"
  ```
- **`AddrInUse`** means an old `deno` is still on `:8787`. Usually harmless:
  it re-bundles `src/main.ts` on every request, so it still serves current
  code. Only `.env` is read once, at startup. To restart:
  `Get-NetTCPConnection -LocalPort 8787 -State Listen | %{ Stop-Process -Id $_.OwningProcess }`
- Don't pipe Deno through PowerShell's `2>&1`. Deno writes download progress to
  stderr, and PowerShell reports that as an error even when the build succeeds.

## What to look at

The page has six numbered stages. Most of the argument is in **stage 3 vs
stage 5**: what the code found versus what Jev made of it.

1. **Revision**: pick a preset (they're in demo order).
2. **Before / After**: the After pane is editable, and stages 3–4 update as you
   type.
3. **Computed diff**: plain code, no model. `by index` means the array had no
   ids, so which element is which is a guess.
4. **Request to Jev**: both full versions plus the diff, sent once for every
   question.
5. **Answers**: a strip of overall readings, then one bar per question.
6. **Operations**: follow-up actions sorted by two thresholds. **Drag the
   sliders.** The actions re-sort from the saved answers, with no new API call.

### The four scenarios worth seeing, and why

- **Claims vs rewording.** Four copy edits that look identical to any
  structural diff. Jev flags the claim with no trigger word ("analysts rank
  first", `.97`) and leaves the decoy that says "no guarantees" alone (`.15`).
  A keyword filter gets both of those wrong.
- **Send windows reshuffled.** The array has no ids, so the diff reports 10
  changes. Jev matches the elements back up, and the 10 turn out to be one
  removal, one edit and one addition.
- **Audience → DE/FR.** The compliance block didn't change, so it isn't in the
  diff, yet Jev spots that it blocks the new regions (`.94`). That's why both
  full versions go in the request.
- **Timezone moved, scheduled vs live.** The diff is the same in both, but the
  answers aren't. "Safe to apply now" drops `.75 → .21` once the campaign is
  live, and "halt delivery" rises from `.09` to `.66`.

More detail on all ten scenarios is in [docs/scenarios.md](docs/scenarios.md).

## Headless tools

The page is the demo. These are what actually test it:

```bash
deno task scenarios               # run all ten live, record fixtures/
deno task scenarios -- creative   # just one, or several by id
deno task scenarios -- --replay   # re-score recorded fixtures, no API calls
deno task scenarios -- --diff     # run live, compare with the last fixtures
deno task scale                   # add more and more changes to check batch size isn't a limit
deno task shoot                   # screenshot the real UI in headless Edge (needs dev server)
deno task check                   # type-check everything
```

Use `--replay` to try threshold or interpretation changes without spending API
calls. Run `--diff` after editing a rubric, to see how every answer moved.

## More docs

- [docs/scenarios.md](docs/scenarios.md): all ten scenarios and what each one
  proves
- [docs/how-it-works.md](docs/how-it-works.md): pipeline, question types,
  thresholds, fixtures and baselines
- [docs/findings.md](docs/findings.md): what each round of live runs found,
  with numbers
