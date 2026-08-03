/**
 * Skill metadata shared by the native Maximo loader and compatibility loaders.
 *
 * The provider is descriptive only. All providers are normalized into the
 * same PromptCommand shape before they reach the command registry.
 */
export const SKILL_PROVIDERS = [
  "maximo",
  "agents",
  "codex",
  "claude",
  "gemini",
  "grok",
  "antigravity",
  "opencode",
] as const;

export type SkillProvider = (typeof SKILL_PROVIDERS)[number];

export type SkillScope = "managed" | "user" | "project" | "additional";
