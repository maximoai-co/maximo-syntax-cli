import * as React from "react";
import { useMemo } from "react";
import {
  type Command,
  type CommandBase,
  getCommandName,
  type PromptCommand,
} from "../../commands.js";
import { Box, Text } from "../../ink.js";
import { Select } from "../CustomSelect/index.js";
import { Dialog } from "../design-system/Dialog.js";
import type {
  LocalJSXCommandOnDone,
} from "../../types/command.js";
import { estimateSkillFrontmatterTokens } from "../../skills/loadSkillsDir.js";
import { getDisplayPath } from "../../utils/file.js";
import { formatTokens } from "../../utils/format.js";

type SkillCommand = CommandBase & PromptCommand;

type Props = {
  onExit: LocalJSXCommandOnDone;
  commands: Command[];
};

type SkillOptionValue = "create" | `use:${string}`;

function isUserVisibleSkill(command: Command): command is SkillCommand {
  return (
    command.type === "prompt" &&
    !command.isHidden &&
    (command.loadedFrom === "skills" ||
      command.loadedFrom === "commands_DEPRECATED" ||
      command.loadedFrom === "plugin" ||
      command.loadedFrom === "mcp")
  );
}

function getSkillLocation(skill: SkillCommand): string {
  if (skill.skillRoot) return getDisplayPath(skill.skillRoot);
  if (skill.skillProvider) return skill.skillProvider;
  return skill.source;
}

function getSkillInvocationName(skill: SkillCommand): string {
  if (skill.skillProvider && skill.skillProvider !== "maximo") {
    return (
      skill.aliases?.find((alias) =>
        alias.startsWith(`${skill.skillProvider}:`),
      ) ?? getCommandName(skill)
    );
  }
  return getCommandName(skill);
}

export function SkillsMenu({ onExit, commands }: Props): React.ReactNode {
  const skills = useMemo(
    () =>
      commands
        .filter(isUserVisibleSkill)
        .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b))),
    [commands],
  );

  const options = useMemo(
    () => [
      {
        label: "Create a new skill",
        value: "create" as const,
        description: "Open the guided /skill-creator interview",
      },
      ...skills.map((skill) => {
        const tokens = formatTokens(estimateSkillFrontmatterTokens(skill));
        const provider = skill.skillProvider ? ` · ${skill.skillProvider}` : "";
        const invocationName = getSkillInvocationName(skill);
        return {
          label: `/${invocationName}`,
          value: `use:${invocationName}` as const,
          description: `${skill.description}${provider} · ~${tokens} tokens · ${getSkillLocation(skill)}`,
        };
      }),
    ],
    [skills],
  );

  const handleCancel = (): void => {
    onExit("Skills picker dismissed", { display: "system" });
  };

  const handleChange = (value: SkillOptionValue): void => {
    if (value === "create") {
      onExit("Opening the skill creator", {
        display: "system",
        nextInput: "/skill-creator ",
        submitNextInput: true,
      });
      return;
    }

    const skillName = value.slice("use:".length);
    onExit("", {
      display: "skip",
      nextInput: `/${skillName} `,
    });
  };

  const subtitle =
    skills.length === 0
      ? "No local skills found"
      : `${skills.length} skill${skills.length === 1 ? "" : "s"} · select to insert its /command`;

  return (
    <Dialog title="Skills" subtitle={subtitle} onCancel={handleCancel}>
      <Box flexDirection="column" gap={1}>
        {skills.length === 0 ? (
          <Text dimColor>
            Skills are loaded from .maximo/skills, .agents/skills, .claude/skills,
            .gemini/skills, .grok/skills, and .opencode/skills.
          </Text>
        ) : null}
        <Select
          options={options}
          onChange={(value: unknown) => handleChange(value as SkillOptionValue)}
          onCancel={handleCancel}
          visibleOptionCount={Math.min(8, Math.max(3, options.length))}
        />
        {skills.length > 0 ? (
          <Box flexDirection="column">
            <Text dimColor>
              Enter inserts the command. Add arguments after the trailing space.
            </Text>
            <Text dimColor>
              Reload discovery with /skills reload. Skill roots are shown in
              descriptions where available.
            </Text>
          </Box>
        ) : null}
      </Box>
    </Dialog>
  );
}
