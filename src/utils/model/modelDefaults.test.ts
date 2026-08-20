import { expect, test } from "bun:test";
import {
  chooseMytabulonDefaultModel,
  MYTABULON_DEFAULT_MODEL,
  normalizeRetiredMytabulonModel,
  RETIRED_MYTABULON_MODEL,
} from "./modelDefaults.js";

test("prefers Atlas 1.2 and skips retired Atlas IDs", () => {
  expect(chooseMytabulonDefaultModel([RETIRED_MYTABULON_MODEL, MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
  expect(chooseMytabulonDefaultModel(["maximo-atlas-1.1", MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
  expect(chooseMytabulonDefaultModel([RETIRED_MYTABULON_MODEL, "maximo-pandora-3.8-nano"])).toBe("maximo-pandora-3.8-nano");
  expect(chooseMytabulonDefaultModel(["maximo-atlas-1.1", "maximo-pandora-3.8-nano"])).toBe("maximo-pandora-3.8-nano");
  expect(chooseMytabulonDefaultModel([])).toBe(MYTABULON_DEFAULT_MODEL);
});

test("migrates retired saved model selections", () => {
  expect(normalizeRetiredMytabulonModel(RETIRED_MYTABULON_MODEL)).toBe(MYTABULON_DEFAULT_MODEL);
  expect(normalizeRetiredMytabulonModel("maximo-atlas-1.1")).toBe(MYTABULON_DEFAULT_MODEL);
  expect(normalizeRetiredMytabulonModel("atlas-1.1")).toBe(MYTABULON_DEFAULT_MODEL);
  expect(normalizeRetiredMytabulonModel("custom-model")).toBe("custom-model");
});
