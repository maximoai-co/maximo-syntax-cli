import type { Command } from "../types/command.js";

// Disabled names are intentionally session-scoped. Persisting a disabled
// third-party skill would create a hidden configuration surface and make a
// future provider upgrade surprising; users can persist their choice by
// adding user-invocable: false to that skill's frontmatter.
const disabledSkillNames = new Set<string>();

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function disableSkill(name: string): void {
  const normalized = normalizeName(name);
  if (normalized) disabledSkillNames.add(normalized);
}

export function enableSkill(name: string): void {
  disabledSkillNames.delete(normalizeName(name));
}

export function isSkillDisabled(command: Command): boolean {
  if (command.type !== "prompt") return false;
  const names = [command.name, ...(command.aliases ?? [])];
  return names.some((name) => disabledSkillNames.has(normalizeName(name)));
}

export function getDisabledSkillNames(): string[] {
  return [...disabledSkillNames].sort();
}

export function clearDisabledSkillsForTesting(): void {
  disabledSkillNames.clear();
}
