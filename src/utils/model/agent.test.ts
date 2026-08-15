import { describe, expect, it } from "bun:test";
import { getAgentModel, isInheritAgentModel } from "./agent.ts";

describe("getAgentModel", () => {
  it("inherits the parent when the tool omits the model or asks to inherit", () => {
    expect(getAgentModel(undefined, "maximo-atlas-1.2")).toBe("maximo-atlas-1.2");
    expect(getAgentModel("inherit", "maximo-atlas-1.2")).toBe("maximo-atlas-1.2");
    expect(getAgentModel(undefined, "maximo-atlas-1.2", "inherit")).toBe("maximo-atlas-1.2");
    expect(getAgentModel(undefined, "maximo-atlas-1.2", "parent")).toBe("maximo-atlas-1.2");
  });

  it("honors a full model slug from the Agent tool call", () => {
    expect(getAgentModel(undefined, "maximo-atlas-1.2", "maximo-pandora-3.8-nano")).toBe(
      "maximo-pandora-3.8-nano",
    );
  });
});

describe("isInheritAgentModel", () => {
  it("treats empty and inherit sentinels as inherit", () => {
    expect(isInheritAgentModel(undefined)).toBe(true);
    expect(isInheritAgentModel("inherit")).toBe(true);
    expect(isInheritAgentModel("same")).toBe(true);
    expect(isInheritAgentModel("grok-4.6")).toBe(false);
  });
});
