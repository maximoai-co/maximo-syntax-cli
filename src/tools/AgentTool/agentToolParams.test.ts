import { describe, expect, it } from "bun:test";
import { isInheritAgentModel } from "../../utils/model/agent.ts";
import {
  deriveAgentDescription,
  normalizeAgentToolInput,
  normalizeEffortInput,
  normalizeIsolation,
  sanitizeOptionalArg,
} from "./agentToolParams.ts";

describe("normalizeAgentToolInput", () => {
  it("accepts Grok-style isolation none and background alias", () => {
    const normalized = normalizeAgentToolInput({
      description: "Analyze video style",
      prompt: "Inspect the frames and report the look.",
      subagent_type: "general-purpose",
      isolation: "none",
      background: true,
      model: "inherit",
    }) as Record<string, unknown>;

    expect(normalized.description).toBe("Analyze video style");
    expect(normalized.prompt).toBe("Inspect the frames and report the look.");
    expect(normalized.isolation).toBeUndefined();
    expect(normalized.run_in_background).toBe(true);
    expect(normalized.background).toBeUndefined();
    expect(normalized.model).toBeUndefined();
  });

  it("maps worktree aliases and full model slugs", () => {
    const normalized = normalizeAgentToolInput({
      task: "Review the auth module thoroughly.",
      isolation: "work_tree",
      model: "maximo-atlas-1.2",
      effort: "Extra High",
    }) as Record<string, unknown>;

    expect(normalized.prompt).toBe("Review the auth module thoroughly.");
    expect(normalized.description).toBe("Review the auth module thoroughly.");
    expect(normalized.isolation).toBe("worktree");
    expect(normalized.model).toBe("maximo-atlas-1.2");
    expect(normalized.effort).toBe("xhigh");
    expect(normalized.task).toBeUndefined();
  });

  it("derives a short description when only prompt is provided", () => {
    const normalized = normalizeAgentToolInput({
      prompt: "Analyze Kimi K3 video style across the extracted frames",
    }) as Record<string, unknown>;

    expect(normalized.description).toBe("Analyze Kimi K3 video style");
  });

  it("leaves a complete Claude-style call untouched", () => {
    const input = {
      description: "Explore auth flow",
      prompt: "Find the login handler and report.",
      subagent_type: "Explore",
      model: "sonnet",
      run_in_background: false,
    };
    expect(normalizeAgentToolInput(input)).toEqual(input);
  });
});

describe("normalizeIsolation", () => {
  it("treats none/shared/false as no isolation", () => {
    expect(normalizeIsolation("none")).toBeUndefined();
    expect(normalizeIsolation("shared")).toBeUndefined();
    expect(normalizeIsolation(false)).toBeUndefined();
    expect(normalizeIsolation("worktree")).toBe("worktree");
    expect(normalizeIsolation("Worktree")).toBe("worktree");
  });
});

describe("normalizeEffortInput", () => {
  it("accepts display spellings and aliases", () => {
    expect(normalizeEffortInput("Extra High")).toBe("xhigh");
    expect(normalizeEffortInput("maximum")).toBe("max");
    expect(normalizeEffortInput("med")).toBe("medium");
    expect(normalizeEffortInput("high")).toBe("high");
    expect(normalizeEffortInput("none")).toBeUndefined();
  });
});

describe("sanitizeOptionalArg / inherit", () => {
  it("drops sentinels", () => {
    expect(sanitizeOptionalArg(" none ")).toBeUndefined();
    expect(sanitizeOptionalArg("null")).toBeUndefined();
    expect(sanitizeOptionalArg("maximo-atlas-1.2")).toBe("maximo-atlas-1.2");
  });

  it("recognizes inherit sentinels", () => {
    expect(isInheritAgentModel("inherit")).toBe(true);
    expect(isInheritAgentModel("parent")).toBe(true);
    expect(isInheritAgentModel("maximo-atlas-1.2")).toBe(false);
  });
});

describe("deriveAgentDescription", () => {
  it("keeps the first five words", () => {
    expect(deriveAgentDescription("Analyze Kimi K3 video style now")).toBe(
      "Analyze Kimi K3 video style",
    );
  });
});
