import assert from "node:assert/strict";
import test from "node:test";

import type { Command } from "../types/command.ts";
import { findSkillMentionAtCursor, parseSkillMentions } from "./skillMentions.ts";

function skill(name: string, aliases?: string[]): Command {
  return {
    type: "prompt",
    name,
    aliases,
    description: name,
    progressMessage: "running",
    contentLength: 0,
    source: "projectSettings",
    loadedFrom: "skills",
    async getPromptForCommand() {
      return [{ type: "text", text: name }];
    },
  };
}

test("parses known $skill mentions and preserves aliases", () => {
  const commands = [
    skill("review", ["code-review", "claude:review"]),
    skill("docs"),
  ];
  const input = "Please use $review and then $claude:review. Leave $HOME alone.";
  const mentions = parseSkillMentions(input, commands);

  assert.deepEqual(
    mentions.map((mention) => [
      mention.commandName,
      input.indexOf("$", mention.start),
    ]),
    [
      ["review", 11],
      ["review", 28],
    ],
  );
  assert.equal(mentions[1]?.invocationName, "claude:review");
});

test("does not parse model-only skills", () => {
  const hidden = skill("internal");
  if (hidden.type === "prompt") hidden.userInvocable = false;

  assert.deepEqual(parseSkillMentions("$internal", [hidden]), []);
});

test("does not treat built-in prompt commands as skills", () => {
  const builtIn = skill("commit");
  if (builtIn.type === "prompt") builtIn.loadedFrom = undefined;

  assert.deepEqual(parseSkillMentions("$commit", [builtIn]), []);
});

test("finds the mention under the cursor", () => {
  const command = skill("review");
  const mention = findSkillMentionAtCursor("Use $review now", 8, [command]);
  assert.equal(mention?.commandName, "review");
});
