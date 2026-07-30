import { expect, test } from "bun:test";
import { cycleSuggestionIndex } from "./useTypeahead.js";

test("cycles slash-command suggestions with Up and Down", () => {
  expect(cycleSuggestionIndex(0, 5, 1)).toBe(1);
  expect(cycleSuggestionIndex(4, 5, 1)).toBe(0);
  expect(cycleSuggestionIndex(0, 5, -1)).toBe(4);
  expect(cycleSuggestionIndex(-1, 5, 1)).toBe(0);
  expect(cycleSuggestionIndex(-1, 5, -1)).toBe(4);
});

test("returns no selection when the menu is empty", () => {
  expect(cycleSuggestionIndex(0, 0, 1)).toBe(-1);
});
