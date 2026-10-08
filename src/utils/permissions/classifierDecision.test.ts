import { expect, test } from 'bun:test'
import { isAutoModeAllowlistedTool } from './classifierDecision.js'

test('skill loading and file discovery never require the auto-mode classifier', () => {
  for (const name of ['Skill', 'Read', 'Glob', 'Grep', 'ToolSearch']) {
    expect(isAutoModeAllowlistedTool(name)).toBe(true)
  }
})

test('skill-related names cannot grant permission to execute arbitrary actions', () => {
  for (const name of ['Bash', 'PowerShell', 'Agent', 'REPL', 'SkillBash', 'mcp__untrusted__Skill']) {
    expect(isAutoModeAllowlistedTool(name)).toBe(false)
  }
})
