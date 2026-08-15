import {
  EFFORT_LEVELS,
  type EffortValue,
  getSupportedEffortLevelsForModel,
  parseEffortValue,
} from "../../utils/effort.js";
import { isInheritAgentModel } from "../../utils/model/agent.js";
import { getModelOptions } from "../../utils/model/modelOptions.js";

const SENTINEL_STRINGS = new Set([
  "",
  "null",
  "none",
  "undefined",
  "n/a",
  "na",
]);

const SHARED_ISOLATION_STRINGS = new Set([
  "none",
  "null",
  "undefined",
  "false",
  "shared",
  "default",
  "off",
  "disabled",
]);

const WORKTREE_ISOLATION_STRINGS = new Set([
  "worktree",
  "work-tree",
  "work_tree",
  "isolated",
  "isolate",
]);

export type AgentIsolationMode = "worktree" | "remote";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && !SENTINEL_STRINGS.has(trimmed.toLowerCase())) {
      return trimmed;
    }
  }
  return undefined;
}

export function sanitizeOptionalArg(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || SENTINEL_STRINGS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}

export function deriveAgentDescription(prompt: string): string {
  const words = prompt.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const title = words.slice(0, 5).join(" ");
  if (!title) return "Sub-agent task";
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

export function normalizeIsolation(
  value: unknown,
): AgentIsolationMode | undefined {
  if (value === undefined || value === null || value === false) {
    return undefined;
  }
  if (value === true) return "worktree";
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized || SHARED_ISOLATION_STRINGS.has(normalized)) {
    return undefined;
  }
  if (WORKTREE_ISOLATION_STRINGS.has(normalized)) return "worktree";
  if (normalized === "remote") return "remote";
  return undefined;
}

export function normalizeEffortInput(value: unknown): EffortValue | undefined {
  return parseEffortValue(sanitizeOptionalArg(value) ?? value);
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

/**
 * Lenient rewrite of model-emitted Agent tool args.
 *
 * Models trained on Grok Build / other harnesses often send `isolation: "none"`,
 * `background` instead of `run_in_background`, a full model slug, or omit
 * `description` while providing `prompt`/`task`. Rewrite those into the
 * advertised schema before Zod validates so a recoverable call is not rejected.
 */
export function normalizeAgentToolInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input };

  const prompt = firstNonEmptyString(
    out.prompt,
    out.task,
    out.instruction,
    out.goal,
    out.query,
  );
  if (prompt) out.prompt = prompt;

  const description = firstNonEmptyString(
    out.description,
    out.title,
    out.summary,
    typeof out.name === "string" && out.team_name == null ? out.name : undefined,
  );
  if (description) {
    out.description = description;
  } else if (prompt) {
    out.description = deriveAgentDescription(prompt);
  }

  if (out.run_in_background == null && out.background != null) {
    const background = coerceBoolean(out.background);
    if (background !== undefined) out.run_in_background = background;
  }
  const runInBackground = coerceBoolean(out.run_in_background);
  if (runInBackground !== undefined) out.run_in_background = runInBackground;

  if ("isolation" in out) {
    const isolation = normalizeIsolation(out.isolation);
    if (isolation) out.isolation = isolation;
    else delete out.isolation;
  }

  if ("model" in out) {
    const model = sanitizeOptionalArg(out.model);
    if (!model || isInheritAgentModel(model)) delete out.model;
    else out.model = model;
  }

  if ("effort" in out) {
    const effort = normalizeEffortInput(out.effort);
    if (effort === undefined) delete out.effort;
    else out.effort = typeof effort === "number" ? String(effort) : effort;
  }

  delete out.background;
  delete out.task;
  delete out.instruction;
  delete out.goal;
  delete out.query;
  delete out.title;
  delete out.summary;

  return out;
}

export function listSubagentModelSlugs(): string[] {
  const slugs = new Set<string>(["inherit"]);
  try {
    for (const option of getModelOptions()) {
      if (typeof option.value === "string" && option.value.trim()) {
        slugs.add(option.value.trim());
      }
    }
  } catch {
    // Catalog may be unavailable during early boot or tests.
  }
  for (const alias of ["sonnet", "opus", "haiku"] as const) {
    slugs.add(alias);
  }
  return [...slugs];
}

export function listSubagentEffortLevels(model?: string): string[] {
  if (model) {
    const supported = getSupportedEffortLevelsForModel(model);
    if (supported?.length) return [...supported];
  }
  return [...EFFORT_LEVELS];
}

export function formatSubagentModelList(slugs: readonly string[]): string {
  if (slugs.length === 0) return "inherit, or any available model slug";
  const shown = slugs.slice(0, 24);
  const extra = slugs.length - shown.length;
  return extra > 0 ? `${shown.join(", ")}, and ${extra} more` : shown.join(", ");
}
