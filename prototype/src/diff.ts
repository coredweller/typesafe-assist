/**
 * Deterministic structural diff. No model involved — this is the half of the
 * problem that has a correct answer, so it is computed exactly and then handed
 * to Jev as part of the state.
 *
 * Two deliberate design choices:
 *
 *  - Arrays whose elements carry a stable id are matched *by that id*, so a
 *    reorder produces no changes at all.
 *  - Arrays without ids (notably schedule.send_windows) are matched by index.
 *    That is the naive behaviour, and the schedule scenario shows it failing:
 *    dropping one element reports almost every field of every later element
 *    as changed. Resolving that is what we ask Jev to do.
 */

import type { Change, ChangeOp } from "./types.ts";

/** Array name -> the property that identifies its elements across versions. */
const ARRAY_KEYS: Record<string, string> = {
  channels: "channel_id",
  creatives: "creative_id",
  approvals: "role",
  allocations: "channel",
  segments: "segment_id",
  // send_windows is intentionally absent — it has no id to match on.
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPrimitive(v: unknown): boolean {
  return v === null || (typeof v !== "object" && typeof v !== "function");
}

/** Key-order-independent structural equality. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
}

function equal(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

/** Last path segment, stripped of any [index] or [key] suffix. */
function arrayName(path: string): string {
  const seg = path.split(".").pop() ?? "";
  return seg.replace(/\[.*\]$/, "");
}

interface Ctx {
  out: Omit<Change, "i">[];
}

function emit(ctx: Ctx, path: string, op: ChangeOp, oldV: unknown, newV: unknown) {
  ctx.out.push({ path, op, old: oldV, new: newV });
}

function walk(before: unknown, after: unknown, path: string, ctx: Ctx): void {
  if (equal(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in before)) emit(ctx, next, "add", undefined, after[key]);
      else if (!(key in after)) emit(ctx, next, "remove", before[key], undefined);
      else walk(before[key], after[key], next, ctx);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    walkArray(before, after, path, ctx);
    return;
  }

  emit(ctx, path, "replace", before, after);
}

function walkArray(
  before: unknown[],
  after: unknown[],
  path: string,
  ctx: Ctx,
): void {
  // Arrays of primitives read far better as one change than as a scatter of
  // per-index edits, and they cost one question instead of several.
  const allPrimitive = [...before, ...after].every(isPrimitive);
  if (allPrimitive) {
    emit(ctx, path, "replace", before, after);
    return;
  }

  const idKey = ARRAY_KEYS[arrayName(path)];

  if (idKey) {
    const keyOf = (el: unknown): string =>
      isPlainObject(el) ? String(el[idKey]) : stable(el);

    const beforeMap = new Map(before.map((el) => [keyOf(el), el]));
    const afterMap = new Map(after.map((el) => [keyOf(el), el]));

    for (const [k, oldEl] of beforeMap) {
      if (!afterMap.has(k)) emit(ctx, `${path}[${k}]`, "remove", oldEl, undefined);
    }
    for (const [k, newEl] of afterMap) {
      if (!beforeMap.has(k)) {
        emit(ctx, `${path}[${k}]`, "add", undefined, newEl);
      } else {
        walk(beforeMap.get(k), newEl, `${path}[${k}]`, ctx);
      }
    }
    return;
  }

  // No id to match on: fall back to position. This is the naive path.
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i++) {
    walk(before[i], after[i], `${path}[${i}]`, ctx);
  }
  for (let i = shared; i < before.length; i++) {
    emit(ctx, `${path}[${i}]`, "remove", before[i], undefined);
  }
  for (let i = shared; i < after.length; i++) {
    emit(ctx, `${path}[${i}]`, "add", undefined, after[i]);
  }
}

/** Paths that change on every save and carry no decision value. */
const IGNORED = new Set(["version", "updated_at", "updated_by"]);

export function diffCampaign(before: unknown, after: unknown): Change[] {
  const ctx: Ctx = { out: [] };
  walk(before, after, "", ctx);
  return ctx.out
    .filter((c) => !IGNORED.has(c.path))
    .map((c, i) => ({ i, ...c }));
}

/** True when the array at `path` was matched by position rather than by id. */
export function isPositionMatched(path: string): boolean {
  const m = path.match(/^(.*?)\[\d+\]/);
  if (!m) return false;
  return !ARRAY_KEYS[arrayName(m[1])];
}

/** Short human rendering of a value for the diff table. */
export function preview(v: unknown, max = 64): string {
  if (v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
