/**
 * Rendering. Pure functions from data to DOM — no state lives here.
 */

import { isPositionMatched, preview } from "./diff.ts";
import type { Interpretation } from "./interpret.ts";
import type { BuiltQuestions } from "./questions.ts";
import type {
  Bucket,
  Change,
  ChoiceAnswer,
  Scenario,
  SystemOneResponse,
  Thresholds,
} from "./types.ts";

type Kid = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false || kid === "") continue;
    el.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 0.86 -> ".86" */
export function fmt(p: number): string {
  return p.toFixed(2).replace(/^0(?=\.)/, "");
}

function bar(p: number, tone: "" | "hit" | "warn", label: string): HTMLElement {
  const fill = h("i");
  fill.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`;
  return h(
    "div",
    { class: `prob${tone ? " " + tone : ""}` },
    h("span", { class: "prob-key", title: label }, label),
    h("span", { class: "bar" }, fill),
    h("span", { class: "prob-val" }, fmt(p)),
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — scenarios
// ---------------------------------------------------------------------------

export function renderScenarios(
  host: HTMLElement,
  scenarios: Scenario[],
  activeId: string,
  onSelect: (id: string) => void,
): void {
  clear(host);
  for (const s of scenarios) {
    const btn = h(
      "button",
      {
        class: "scn",
        type: "button",
        "aria-pressed": String(s.id === activeId),
      },
      s.title,
    );
    btn.addEventListener("click", () => onSelect(s.id));
    host.append(btn);
  }
}

export function renderScenarioText(
  blurbEl: HTMLElement,
  provesEl: HTMLElement,
  s: Scenario,
): void {
  blurbEl.textContent = s.blurb;
  clear(provesEl);
  provesEl.append(h("b", {}, "What this proves: "), s.proves);
}

// ---------------------------------------------------------------------------
// Stage 3 — diff table
// ---------------------------------------------------------------------------

export function renderDiff(
  table: HTMLTableElement,
  countEl: HTMLElement,
  noteEl: HTMLElement,
  changes: Change[],
): void {
  clear(table);
  countEl.textContent = `${changes.length} change${changes.length === 1 ? "" : "s"}`;

  const suspect = changes.filter((c) => isPositionMatched(c.path)).length;
  noteEl.textContent = suspect > 0
    ? `${suspect} in a position-matched array — identity is unreliable`
    : "all arrays matched by stable id";

  table.append(
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", {}, "#"),
        h("th", {}, "path"),
        h("th", {}, "op"),
        h("th", {}, "before"),
        h("th", {}, "after"),
      ),
    ),
  );

  const body = h("tbody");
  if (changes.length === 0) {
    body.append(
      h("tr", {}, h("td", { colspan: "5" }, h("span", { class: "empty" }, "No changes."))),
    );
  }
  for (const c of changes) {
    const sus = isPositionMatched(c.path);
    body.append(
      h(
        "tr",
        sus ? { class: "suspect" } : {},
        h("td", { class: "op" }, String(c.i)),
        h("td", { class: "path" }, c.path, sus ? " " : "", sus ? h("span", { class: "tag warn" }, "by index") : ""),
        h("td", { class: "op" }, h("span", { class: `tag ${c.op}` }, c.op)),
        h("td", { class: "val" }, preview(c.old, 70)),
        h("td", { class: "val" }, preview(c.new, 70)),
      ),
    );
  }
  table.append(body);
}

// ---------------------------------------------------------------------------
// Stage 5 — answers
// ---------------------------------------------------------------------------

function choiceBars(a: ChoiceAnswer, limit = 5): HTMLElement {
  const box = h("div");
  const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
  for (const [opt, p] of ranked.slice(0, limit)) {
    box.append(bar(p, opt === a.choice ? "hit" : "", opt));
  }
  return box;
}

function readingsStrip(interp: Interpretation): HTMLElement {
  const strip = h("div", { class: "readings" });

  const add = (label: string, value: string, sub?: string) => {
    strip.append(
      h(
        "dl",
        { class: "reading" },
        h("dt", {}, label),
        h("dd", {}, value, sub ? h("small", {}, ` ${sub}`) : ""),
      ),
    );
  };

  add("theme", interp.theme?.choice ?? "—", interp.theme ? fmt(interp.theme.confidence) : "");
  add(
    "blast radius",
    interp.blastRadius?.choice.replace(/_/g, " ") ?? "—",
    interp.blastRadius ? fmt(interp.blastRadius.confidence) : "",
  );
  // Derived from the operation gates rather than asked. Shown next to the
  // asked one precisely so the two can be seen disagreeing.
  add("↳ derived", interp.derivedBlastRadius.replace(/_/g, " "), "computed");
  add(
    "apply in place",
    interp.safeWhileLive === null
      ? "—"
      // A coin flip is not a decision; say so instead of rounding it.
      : Math.abs(interp.safeWhileLive - 0.5) < 0.1
      ? "unclear"
      : interp.safeWhileLive >= 0.5
      ? "yes"
      : "no",
    interp.safeWhileLive === null ? "" : fmt(interp.safeWhileLive),
  );
  add(
    "approval stale",
    interp.invalidatesApproval === null
      ? "—"
      : interp.invalidatesApproval >= 0.5
      ? "yes"
      : "no",
    interp.invalidatesApproval === null ? "" : fmt(interp.invalidatesApproval),
  );
  add(
    "consent conflict",
    interp.consentConflict === null ? "—" : interp.consentConflict >= 0.5 ? "yes" : "no",
    interp.consentConflict === null ? "" : fmt(interp.consentConflict),
  );
  add(
    "new claim in copy",
    interp.claimRisk === null ? "—" : interp.claimRisk >= 0.5 ? "yes" : "no",
    interp.claimRisk === null ? "" : fmt(interp.claimRisk),
  );

  return strip;
}

export function renderAnswers(
  host: HTMLElement,
  response: SystemOneResponse,
  built: BuiltQuestions,
  interp: Interpretation,
): void {
  clear(host);
  host.append(readingsStrip(interp));

  for (const f of interp.flags) {
    host.append(h("div", { class: "flag" }, f));
  }

  // Materiality, per change.
  const mat = h("div", { class: "qgroup" }, h("h4", {}, "materiality — one noul per change"));
  if (interp.changes.length === 0) {
    mat.append(h("div", { class: "empty" }, "No changes to grade."));
  }
  for (const v of interp.changes) {
    mat.append(bar(v.probability, v.material ? "hit" : "", `${v.change.i}  ${v.change.path}`));
  }
  host.append(mat);

  // Array element identity, when the diff matched by position.
  if (interp.identities.length > 0) {
    const idg = h(
      "div",
      { class: "qgroup" },
      h("h4", {}, "array element identity — resolving what the diff could not"),
    );
    for (const v of interp.identities) {
      const label = `${v.target.arrayPath}[${v.target.afterIndex}] ← ` +
        (v.resolvedTo === null ? "new entry" : `was index ${v.resolvedTo}`);
      idg.append(bar(v.confidence, v.moved ? "warn" : "hit", label));
    }
    host.append(idg);
  }

  // Raw choice distributions worth seeing in full.
  for (const key of ["theme", "blast_radius"]) {
    const a = response.answers?.[key];
    if (a && a.type === "choice") {
      host.append(
        h("div", { class: "qgroup" }, h("h4", {}, `${key} — full distribution`), choiceBars(a)),
      );
    }
  }

  const usage = response.usage && Object.keys(response.usage).length > 0
    ? Object.entries(response.usage).map(([k, v]) => `${k}=${v}`).join("  ")
    : "none reported";
  host.append(
    h(
      "div",
      { class: "hint" },
      `model ${response.model} · ${Object.keys(built.questions).length} questions sent · ` +
        `${Object.keys(response.answers ?? {}).length} answers returned · usage: ${usage}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Stage 6 — operations
// ---------------------------------------------------------------------------

const BUCKET_TITLES: Record<Bucket, string> = {
  required: "Required",
  review: "Needs review",
  skip: "Not needed",
};

export function renderOperations(
  host: HTMLElement,
  interp: Interpretation,
  thresholds: Thresholds,
  onChange: (t: Thresholds) => void,
): void {
  clear(host);

  const gates = h("div", { class: "gates" });

  const mkGate = (
    label: string,
    value: number,
    apply: (v: number) => Thresholds,
  ) => {
    const out = h("b", {}, fmt(value));
    const input = h("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      value: String(value),
      id: `gate-${label.replace(/\s+/g, "-")}`,
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      out.textContent = fmt(Number(input.value));
    });
    input.addEventListener("change", () => onChange(apply(Number(input.value))));
    return h("label", { class: "gate", for: input.id }, label, input, out);
  };

  gates.append(
    mkGate("required ≥", thresholds.high, (v) => ({ ...thresholds, high: v })),
    mkGate("review ≥", thresholds.low, (v) => ({ ...thresholds, low: v })),
    h("span", { class: "gate" }, "re-buckets locally — no second API call"),
  );
  host.append(gates);

  const buckets = h("div", { class: "buckets" });
  for (const b of ["required", "review", "skip"] as Bucket[]) {
    const items = interp.operations.filter((o) => o.bucket === b);
    const col = h(
      "div",
      { class: `bucket ${b}` },
      h("h4", {}, BUCKET_TITLES[b], h("em", {}, `${items.length}`)),
    );
    if (items.length === 0) col.append(h("div", { class: "empty" }, "—"));
    for (const op of items) {
      col.append(
        h(
          "div",
          { class: "op", title: op.description },
          h(
            "div",
            { class: "op-top" },
            h("span", { class: "op-label" }, op.label),
            h("span", { class: "op-p" }, fmt(op.probability)),
          ),
          h("div", { class: "op-ep" }, op.endpoint),
        ),
      );
    }
    buckets.append(col);
  }
  host.append(buckets);
}
