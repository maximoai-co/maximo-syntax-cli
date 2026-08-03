import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { getSkillDirCommands, clearSkillCaches } from './loadSkillsDir.ts'

function writeSkill(rootDir: string, skillPath: string): void {
  const skillDir = join(rootDir, '.maximo', 'skills', ...skillPath.split('/'))
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\ndescription: ${skillPath}\n---\n# ${skillPath}\n`,
    'utf8',
  )
}

function writeCompatibilitySkill(
  rootDir: string,
  providerDirectory: string,
  skillName: string,
): void {
  const skillDir = join(rootDir, providerDirectory, 'skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\ndescription: ${providerDirectory}/${skillName}\n---\n# ${skillName}\n`,
    'utf8',
  )
}

test('loads flat and nested skills with colon namespaces', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = process.env.MAXIMO_CONFIG_DIR

  try {
    mkdirSync(cwd, { recursive: true })
    writeSkill(configDir, 'flat-skill')
    writeSkill(configDir, 'git/commit')
    writeSkill(configDir, 'frontend/react/form')

    process.env.MAXIMO_CONFIG_DIR = configDir
    clearSkillCaches()

    const skills = await getSkillDirCommands(cwd)
    // The compatibility loader intentionally includes real user skills from
    // ~/.agents, ~/.claude, etc. Keep this fixture isolated to the temporary
    // native Maximo root while still exercising the shared loader.
    const promptSkills = skills.filter(
      skill => skill.type === 'prompt' && skill.skillRoot?.startsWith(configDir),
    )
    const skillNames = promptSkills.map(skill => skill.name).sort()

    assert.deepEqual(skillNames, [
      'flat-skill',
      'frontend:react:form',
      'git:commit',
    ])

    const nestedSkill = promptSkills.find(skill => skill.name === 'git:commit')
    assert.ok(nestedSkill)
    assert.equal(nestedSkill.skillRoot, join(configDir, '.maximo', 'skills', 'git', 'commit'))

    const deepSkill = promptSkills.find(
      skill => skill.name === 'frontend:react:form',
    )
    assert.ok(deepSkill)
    assert.equal(
      deepSkill.skillRoot,
      join(configDir, '.maximo', 'skills', 'frontend', 'react', 'form'),
    )
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.MAXIMO_CONFIG_DIR
    } else {
      process.env.MAXIMO_CONFIG_DIR = originalConfigDir
    }
    clearSkillCaches()
    rmSync(configDir, { recursive: true, force: true })
  }
})

test('loads compatible provider roots and exposes qualified aliases', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'maximo-compatible-skills-'))
  const originalConfigDir = process.env.MAXIMO_CONFIG_DIR

  try {
    writeCompatibilitySkill(rootDir, '.agents', 'review')
    writeCompatibilitySkill(rootDir, '.claude', 'review')

    process.env.MAXIMO_CONFIG_DIR = join(rootDir, 'config')
    clearSkillCaches()

    const skills = await getSkillDirCommands(rootDir)
    const projectSkills = skills.filter(
      skill => skill.type === 'prompt' && skill.skillRoot?.startsWith(rootDir),
    )
    const byProvider = new Map(
      projectSkills
        .filter(skill => skill.type === 'prompt' && skill.skillProvider)
        .map(skill => [skill.skillProvider, skill]),
    )

    assert.equal(byProvider.get('agents')?.name, 'review')
    assert.deepEqual(byProvider.get('agents')?.aliases, ['agents:review'])
    assert.equal(byProvider.get('claude')?.name, 'review')
    assert.deepEqual(byProvider.get('claude')?.aliases, ['claude:review'])
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.MAXIMO_CONFIG_DIR
    } else {
      process.env.MAXIMO_CONFIG_DIR = originalConfigDir
    }
    clearSkillCaches()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
