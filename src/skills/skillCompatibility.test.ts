import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getSkillDiscoveryLocations,
  getSkillProviderForDirectory,
} from "./skillCompatibility.ts";

test("returns deterministic native and compatibility roots", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "maximo-skill-roots-"));
  const originalConfigDir = process.env.MAXIMO_CONFIG_DIR;
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    process.env.MAXIMO_CONFIG_DIR = join(rootDir, "config");
    process.env.CODEX_HOME = join(rootDir, "codex");
    const locations = getSkillDiscoveryLocations(rootDir);
    const paths = locations.map((location) => location.path);

    assert.equal(locations[0]?.provider, "maximo");
    assert.equal(locations[0]?.scope, "managed");
    assert.ok(paths.includes(join(rootDir, ".agents", "skills")));
    assert.ok(paths.includes(join(rootDir, "codex", "skills")));
    assert.ok(paths.includes(join(rootDir, ".claude", "skills")));
    assert.ok(paths.includes(join(rootDir, ".gemini", "skills")));
    assert.ok(paths.includes(join(rootDir, ".grok", "skills")));
    assert.ok(paths.includes(join(rootDir, ".opencode", "skills")));
    assert.ok(paths.includes(join(rootDir, "config", "skills")));
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.MAXIMO_CONFIG_DIR;
    } else {
      process.env.MAXIMO_CONFIG_DIR = originalConfigDir;
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("maps documented provider roots", () => {
  assert.equal(getSkillProviderForDirectory("/tmp/.agents/skills"), "agents");
  assert.equal(getSkillProviderForDirectory("/tmp/.codex/skills"), "codex");
  assert.equal(getSkillProviderForDirectory("/tmp/.claude/skills"), "claude");
  assert.equal(getSkillProviderForDirectory("/tmp/.gemini/skills"), "gemini");
  assert.equal(
    getSkillProviderForDirectory("/tmp/.gemini/config/skills"),
    "antigravity",
  );
  assert.equal(getSkillProviderForDirectory("/tmp/.grok/skills"), "grok");
  assert.equal(
    getSkillProviderForDirectory("/tmp/.config/opencode/skills"),
    "opencode",
  );
});
