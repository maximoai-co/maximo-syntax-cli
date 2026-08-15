import { expect, test } from "bun:test";
import {
  chooseMytabulonDefaultModel,
  MYTABULON_DEFAULT_MODEL,
  normalizeRetiredMytabulonModel,
  RETIRED_MYTABULON_MODEL,
} from "./modelDefaults.js";

test("prefers Atlas 1.2 and skips the retired Atlas Preview ID", () => {
  expect(chooseMytabulonDefaultModel([RETIRED_MYTABULON_MODEL, MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
  expect(chooseMytabulonDefaultModel([RETIRED_MYTABULON_MODEL, "maximo-pandora-3.8-nano"])).toBe("maximo-pandora-3.8-nano");
  expect(chooseMytabulonDefaultModel([])).toBe(MYTABULON_DEFAULT_MODEL);
});

test("migrates a retired saved model selection", () => {
  expect(normalizeRetiredMytabulonModel(RETIRED_MYTABULON_MODEL)).toBe(MYTABULON_DEFAULT_MODEL);
  expect(normalizeRetiredMytabulonModel("custom-model")).toBe("custom-model");
});
