import assert from "node:assert/strict";
import test from "node:test";

import type { Command } from "../../types/command.ts";
import {
  applySkillMentionSuggestion,
  findMidInputSkillMention,
  generateSkillMentionSuggestions,
} from "./commandSuggestions.ts";

function skill(
  name: string,
  aliases: string[] = [],
  provider?: "claude" | "agents",
): Command {
  return {
    type: "prompt",
    name,
    aliases,
    description: name,
    progressMessage: "running",
    contentLength: 0,
    source: "projectSettings",
    loadedFrom: "skills",
    skillProvider: provider,
    async getPromptForCommand() {
      return [{ type: "text", text: name }];
    },
  };
}

test("suggests provider-qualified skill mentions", () => {
  const compatible = skill("review", ["claude:review"], "claude");
  const builtIn = skill("commit");
  builtIn.loadedFrom = undefined;

  const suggestions = generateSkillMentionSuggestions("claude:", [
    compatible,
    builtIn,
  ]);

  assert.deepEqual(suggestions.map((suggestion) => suggestion.displayText), [
    "$claude:review",
  ]);
});

test("applies an inline skill mention without submitting the prompt", () => {
  const input = "Please use $cla now";
  const token = findMidInputSkillMention(input, 15);
  assert.equal(token?.partialSkill, "cla");

  const suggestion = {
    id: "skill-mention-claude:review-projectSettings",
    displayText: "$claude:review",
  };
  let nextInput = input;
  let nextCursor = 15;
  applySkillMentionSuggestion(
    suggestion,
    input,
    15,
    (value) => {
      nextInput = value;
    },
    (offset) => {
      nextCursor = offset;
    },
  );

  assert.equal(nextInput, "Please use $claude:review  now");
  assert.equal(nextCursor, "Please use $claude:review ".length);
});
