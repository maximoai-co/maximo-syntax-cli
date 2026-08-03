import type { Command } from "../types/command.js";

export type UserInvocableSkillCommand = Extract<Command, { type: "prompt" }>;

const SKILL_SOURCES = new Set([
  "commands_DEPRECATED",
  "skills",
  "plugin",
  "managed",
  "bundled",
  "mcp",
]);

export function isUserInvocableSkill(
  command: Command,
): command is UserInvocableSkillCommand {
  return (
    command.type === "prompt" &&
    !command.isHidden &&
    command.userInvocable !== false &&
    SKILL_SOURCES.has(command.loadedFrom ?? "")
  );
}

export function getSkillInvocationName(
  skill: UserInvocableSkillCommand,
): string {
  if (skill.skillProvider && skill.skillProvider !== "maximo") {
    return (
      skill.aliases?.find((alias) =>
        alias.startsWith(`${skill.skillProvider}:`),
      ) ?? skill.userFacingName?.() ?? skill.name
    );
  }
  return skill.userFacingName?.() ?? skill.name;
}

export type SkillMention = {
  /** Canonical command name used to deduplicate repeated mentions. */
  commandName: string;
  /** The exact user-facing name, preserving provider-qualified aliases. */
  invocationName: string;
  /** The complete `$skill-name` token range in the original prompt. */
  start: number;
  end: number;
  command: Command;
};

const SKILL_MENTION_RE = /(^|[\s(])\$([A-Za-z][A-Za-z0-9:_-]*)/g;

function findCommandForMention(
  name: string,
  commands: Command[],
): Command | undefined {
  const normalized = name.toLowerCase();
  return commands.find((command) => {
    if (!isUserInvocableSkill(command)) return false;
    return (
      command.name.toLowerCase() === normalized ||
      command.aliases?.some((alias) => alias.toLowerCase() === normalized) ===
        true
    );
  });
}

/**
 * Find explicit `$skill` mentions in a user prompt.
 *
 * Only known, user-invocable prompt commands are returned. This keeps normal
 * shell variables (`$HOME`, `$0`) and unknown prose untouched, and prevents a
 * remote/plain-text input from gaining a new execution path accidentally.
 */
export function parseSkillMentions(
  input: string,
  commands: Command[],
): SkillMention[] {
  const mentions: SkillMention[] = [];
  SKILL_MENTION_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SKILL_MENTION_RE.exec(input)) !== null) {
    const name = match[2];
    if (!name) continue;
    const command = findCommandForMention(name, commands);
    if (!command) continue;
    const normalizedName = name.toLowerCase();
    const invocationName =
      command.name.toLowerCase() === normalizedName
        ? command.name
        : command.aliases?.find(
            (alias) => alias.toLowerCase() === normalizedName,
          ) ?? command.name;

    const prefixLength = match[1]?.length ?? 0;
    const start = match.index + prefixLength;
    mentions.push({
      commandName: command.name,
      invocationName,
      start,
      end: start + name.length + 1,
      command,
    });
  }

  return mentions;
}

export function findSkillMentionAtCursor(
  input: string,
  cursorOffset: number,
  commands: Command[],
): SkillMention | undefined {
  const mentions = parseSkillMentions(input, commands);
  return mentions.find(
    (mention) => mention.start <= cursorOffset && mention.end >= cursorOffset,
  );
}
