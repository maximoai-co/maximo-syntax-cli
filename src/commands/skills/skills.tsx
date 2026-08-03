import { lstat, mkdir, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as React from "react";
import { findCommand, getCommandName, type Command } from "../../commands.js";
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from "../../types/command.js";
import { getCwd } from "../../utils/cwd.js";
import { reloadNow } from "../../utils/skills/skillChangeDetector.js";
import { SkillsMenu } from "../../components/skills/SkillsMenu.js";
import {
  disableSkill,
  enableSkill,
  getDisabledSkillNames,
} from "../../skills/skillManager.js";

function getPromptSkill(
  name: string,
  context: LocalJSXCommandContext,
): Extract<Command, { type: "prompt" }> | undefined {
  const command = findCommand(name, context.options.commands);
  return command?.type === "prompt" ? command : undefined;
}

function getRequestedSkillName(
  skill: Extract<Command, { type: "prompt" }>,
  requestedName: string,
): string {
  if (
    skill.name === requestedName ||
    getCommandName(skill) === requestedName ||
    skill.aliases?.includes(requestedName)
  ) {
    return requestedName;
  }
  return getCommandName(skill);
}

function finish(onDone: LocalJSXCommandOnDone, message: string): null {
  onDone(message, { display: "system" });
  return null;
}

async function linkSkill(
  rawArgs: string,
  onDone: LocalJSXCommandOnDone,
): Promise<null> {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  const sourceArg = tokens.shift();
  if (!sourceArg) {
    return finish(
      onDone,
      "Usage: /skills link <skill-directory-or-SKILL.md> [--scope user|workspace]",
    );
  }

  let scope: "user" | "workspace" = "workspace";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--scope") {
      const value = tokens[index + 1];
      if (value !== "user" && value !== "workspace") {
        return finish(onDone, "--scope must be either user or workspace.");
      }
      scope = value;
      index += 1;
    } else if (token?.startsWith("--scope=")) {
      const value = token.slice("--scope=".length);
      if (value !== "user" && value !== "workspace") {
        return finish(onDone, "--scope must be either user or workspace.");
      }
      scope = value;
    } else {
      return finish(onDone, `Unexpected argument: ${token}`);
    }
  }

  const source = sourceArg.startsWith("~/")
    ? resolve(join(homedir(), sourceArg.slice(2)))
    : resolve(getCwd(), sourceArg);
  let sourceStats;
  try {
    sourceStats = await stat(source);
  } catch {
    return finish(onDone, `Skill path does not exist: ${source}`);
  }

  const skillDirectory = sourceStats.isDirectory() ? source : dirname(source);
  if (!sourceStats.isDirectory() && basename(source) !== "SKILL.md") {
    return finish(onDone, "When linking a file, the file must be named SKILL.md.");
  }
  try {
    const skillFile = join(skillDirectory, "SKILL.md");
    const skillFileStats = await stat(skillFile);
    if (!skillFileStats.isFile()) throw new Error("not a regular file");
  } catch {
    return finish(onDone, `No SKILL.md found directly inside ${skillDirectory}`);
  }

  const skillName = basename(skillDirectory);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    return finish(
      onDone,
      `Skill directory name '${skillName}' must use lowercase letters, numbers, and hyphens.`,
    );
  }

  const destinationRoot =
    scope === "user"
      ? join(homedir(), ".agents", "skills")
      : join(getCwd(), ".agents", "skills");
  const destination = join(destinationRoot, skillName);
  try {
    await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
    await lstat(destination);
    return finish(onDone, `A skill already exists at ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return finish(onDone, `Cannot use ${destination}: ${String(error)}`);
    }
  }

  try {
    await symlink(
      skillDirectory,
      destination,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    return finish(onDone, `Unable to link skill: ${String(error)}`);
  }

  reloadNow();
  return finish(
    onDone,
    `Linked ${skillDirectory} into ${destination}. It is available as /${skillName}.`,
  );
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args = "",
): Promise<React.ReactNode> {
  const trimmed = args.trim();
  const [action = "list", ...rest] = trimmed.split(/\s+/);
  const remainder = rest.join(" ").trim();

  if (action === "list") {
    return <SkillsMenu onExit={onDone} commands={context.options.commands} />;
  }

  if (action === "reload") {
    reloadNow();
    return finish(onDone, "Skill discovery reloaded.");
  }

  if (action === "create") {
    onDone("Opening the skill creator", {
      display: "system",
      nextInput: "/skill-creator ",
      submitNextInput: true,
    });
    return null;
  }

  if (action === "use") {
    const skill = getPromptSkill(remainder, context);
    if (!skill || skill.userInvocable === false) {
      return finish(onDone, `Unknown user-invocable skill: ${remainder}`);
    }
    onDone("", {
      display: "skip",
      nextInput: `/${getRequestedSkillName(skill, remainder)} `,
    });
    return null;
  }

  if (action === "info") {
    const skill = getPromptSkill(remainder, context);
    if (!skill) return finish(onDone, `Unknown skill: ${remainder}`);
    const aliases = skill.aliases?.length
      ? `Aliases: ${skill.aliases.join(", ")}`
      : "Aliases: none";
    return finish(
      onDone,
      [
        `/${getRequestedSkillName(skill, remainder)}`,
        skill.description,
        `Provider: ${skill.skillProvider ?? "native"}`,
        `Scope: ${skill.skillScope ?? "unknown"}`,
        `Root: ${skill.skillRoot ?? "unknown"}`,
        aliases,
      ].join("\n"),
    );
  }

  if (action === "disable") {
    const skill = getPromptSkill(remainder, context);
    if (!skill || skill.loadedFrom === "bundled") {
      return finish(onDone, `Unknown local skill: ${remainder}`);
    }
    const disabledName = getRequestedSkillName(skill, remainder);
    disableSkill(disabledName);
    reloadNow();
    return finish(
      onDone,
      `Disabled /${disabledName} for this session. Use /skills enable ${disabledName} to restore it.`,
    );
  }

  if (action === "enable") {
    enableSkill(remainder);
    reloadNow();
    return finish(
      onDone,
      `Enabled /${remainder}. If it exists in a supported root, it is available now.`,
    );
  }

  if (action === "disabled") {
    const disabled = getDisabledSkillNames();
    return finish(
      onDone,
      disabled.length > 0
        ? `Disabled for this session: ${disabled.join(", ")}`
        : "No skills are disabled for this session.",
    );
  }

  if (action === "link") {
    return linkSkill(remainder, onDone);
  }

  return finish(
    onDone,
    "Usage: /skills [list|reload|create|use <name>|info <name>|enable <name>|disable <name>|disabled|link <path> [--scope user|workspace]]",
  );
}
