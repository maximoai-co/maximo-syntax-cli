import { expect, test } from "bun:test";
import {
  isMemoryFilePath,
  PROJECT_INSTRUCTION_FILE_NAMES,
} from "./maximomd.js";

test("recognizes Maximo and migration-compatible project instructions", () => {
  expect(PROJECT_INSTRUCTION_FILE_NAMES).toEqual([
    "AGENTS.md",
    "CLAUDE.md",
    "MAXIMO.md",
  ]);
  expect(isMemoryFilePath("/workspace/AGENTS.md")).toBe(true);
  expect(isMemoryFilePath("/workspace/CLAUDE.md")).toBe(true);
  expect(isMemoryFilePath("/workspace/MAXIMO.md")).toBe(true);
  expect(isMemoryFilePath("/workspace/MAXIMO.local.md")).toBe(true);
  expect(isMemoryFilePath("/workspace/CLAUDE.local.md")).toBe(true);
});
