import { homedir } from "os";
import { dirname, join, resolve, sep } from "path";
import { getManagedFilePath } from "../utils/settings/managedPath.js";
import { getMaximoConfigHomeDir } from "../utils/envUtils.js";
import { findGitRoot } from "../utils/git.js";
import type { SettingSource } from "../utils/settings/constants.js";
import type { SkillProvider, SkillScope } from "../types/skill.js";

export type SkillDiscoveryLocation = {
  path: string;
  source: SettingSource;
  provider: SkillProvider;
  scope: SkillScope;
  label: string;
};

type ProviderRoot = {
  provider: SkillProvider;
  relativePath: string;
  label: string;
};

/**
 * These are deliberately explicit. Skill discovery must never recurse through
 * arbitrary user directories, because a SKILL.md is executable instruction
 * content once it is invoked.
 */
const PROJECT_PROVIDER_ROOTS: readonly ProviderRoot[] = [
  { provider: "maximo", relativePath: ".maximo/skills", label: "Maximo" },
  { provider: "agents", relativePath: ".agents/skills", label: "Agent Skills" },
  { provider: "claude", relativePath: ".claude/skills", label: "Claude Code" },
  { provider: "gemini", relativePath: ".gemini/skills", label: "Gemini CLI" },
  { provider: "grok", relativePath: ".grok/skills", label: "Grok CLI" },
  { provider: "opencode", relativePath: ".opencode/skills", label: "OpenCode" },
];

const USER_PROVIDER_ROOTS: readonly ProviderRoot[] = [
  { provider: "maximo", relativePath: "skills", label: "Maximo" },
  { provider: "agents", relativePath: ".agents/skills", label: "Agent Skills" },
  { provider: "codex", relativePath: "skills", label: "Codex CLI" },
  { provider: "claude", relativePath: ".claude/skills", label: "Claude Code" },
  { provider: "gemini", relativePath: ".gemini/skills", label: "Gemini CLI" },
  {
    provider: "antigravity",
    relativePath: ".gemini/config/skills",
    label: "Antigravity",
  },
  {
    provider: "antigravity",
    relativePath: ".gemini/antigravity-cli/skills",
    label: "Antigravity CLI",
  },
  { provider: "grok", relativePath: ".grok/skills", label: "Grok CLI" },
  {
    provider: "opencode",
    relativePath: ".config/opencode/skills",
    label: "OpenCode",
  },
];

function normalizeLocationPath(path: string): string {
  const resolved = resolve(path);
  return resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved;
}

function pushUnique(
  locations: SkillDiscoveryLocation[],
  location: SkillDiscoveryLocation,
): void {
  const normalized = normalizeLocationPath(location.path);
  if (locations.some((candidate) => normalizeLocationPath(candidate.path) === normalized)) {
    return;
  }
  locations.push({ ...location, path: normalized });
}

function getProjectDirectories(cwd: string): string[] {
  const home = normalizeLocationPath(homedir());
  const resolvedCwd = normalizeLocationPath(cwd);
  const gitRoot = findGitRoot(resolvedCwd);
  const boundary = normalizeLocationPath(gitRoot ?? home);
  const directories: string[] = [];
  let current = resolvedCwd;

  while (true) {
    directories.push(current);
    if (current === boundary || current === home) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return directories;
}

function getProjectLocations(
  cwd: string,
  scope: SkillScope = "project",
): SkillDiscoveryLocation[] {
  const locations: SkillDiscoveryLocation[] = [];
  for (const directory of getProjectDirectories(cwd)) {
    for (const root of PROJECT_PROVIDER_ROOTS) {
      pushUnique(locations, {
        path: join(directory, root.relativePath),
        source: "projectSettings",
        provider: root.provider,
        scope,
        label: root.label,
      });
    }
  }
  return locations;
}

function getUserLocations(): SkillDiscoveryLocation[] {
  const locations: SkillDiscoveryLocation[] = [];
  const configHome = getMaximoConfigHomeDir();
  const home = homedir();
  const codexHome = process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME)
    : join(home, ".codex");

  for (const root of USER_PROVIDER_ROOTS) {
    const base =
      root.provider === "maximo"
        ? configHome
        : root.provider === "codex"
          ? codexHome
          : home;
    pushUnique(locations, {
      path: join(base, root.relativePath),
      source: "userSettings",
      provider: root.provider,
      scope: "user",
      label: root.label,
    });
  }
  return locations;
}

/**
 * Return every explicitly supported skill root in precedence order.
 *
 * Native Maximo roots are first. User compatibility roots follow, then the
 * most-specific project roots through the repository boundary. The loader is
 * first-wins for a bare skill name, while provider-qualified aliases keep all
 * same-named skills addressable.
 */
export function getSkillDiscoveryLocations(cwd: string): SkillDiscoveryLocation[] {
  const locations: SkillDiscoveryLocation[] = [];
  const managedSkills = join(getManagedFilePath(), ".maximo", "skills");

  pushUnique(locations, {
    path: managedSkills,
    source: "policySettings",
    provider: "maximo",
    scope: "managed",
    label: "Managed Maximo",
  });

  for (const location of getUserLocations()) pushUnique(locations, location);
  for (const location of getProjectLocations(cwd)) pushUnique(locations, location);

  return locations;
}

/**
 * Resolve only the fixed skill roots beneath an explicit --add-dir path.
 * Additional directories are user-provided, so they are never walked beyond
 * these known provider layouts.
 */
export function getAdditionalSkillDiscoveryLocations(
  directory: string,
): SkillDiscoveryLocation[] {
  const base = normalizeLocationPath(directory);
  return PROJECT_PROVIDER_ROOTS.map((root) => ({
    path: join(base, root.relativePath),
    source: "projectSettings" as const,
    provider: root.provider,
    scope: "additional" as const,
    label: `Additional ${root.label}`,
  }));
}

/** Infer a provider from a known compatibility root. */
export function getSkillProviderForDirectory(
  directory: string,
): SkillProvider {
  const normalized = normalizeLocationPath(directory).split(sep).join("/");
  if (normalized.includes("/.claude/skills")) return "claude";
  if (normalized.includes("/.gemini/config/skills")) return "antigravity";
  if (normalized.includes("/.gemini/antigravity-cli/skills")) return "antigravity";
  if (normalized.includes("/.gemini/skills")) return "gemini";
  if (normalized.includes("/.grok/skills")) return "grok";
  if (
    normalized.includes("/.opencode/skills") ||
    normalized.includes("/.config/opencode/skills")
  ) {
    return "opencode";
  }
  if (normalized.includes("/.agents/skills")) return "agents";
  if (normalized.includes("/.codex/skills")) return "codex";
  return "maximo";
}

export function getSkillScopeForDirectory(directory: string): SkillScope {
  const normalized = normalizeLocationPath(directory).split(sep).join("/");
  const userRoots = getUserLocations().map((location) =>
    normalizeLocationPath(location.path).split(sep).join("/"),
  );
  if (userRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    return "user";
  }
  return "project";
}

/** Return all provider roots at one project directory for dynamic discovery. */
export function getProjectSkillDiscoveryLocations(
  projectDirectory: string,
): SkillDiscoveryLocation[] {
  return PROJECT_PROVIDER_ROOTS.map((root) => ({
    path: join(projectDirectory, root.relativePath),
    source: "projectSettings" as const,
    provider: root.provider,
    scope: "project" as const,
    label: root.label,
  }));
}
