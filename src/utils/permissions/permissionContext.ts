/** Verbatim human turns, kept separately from model summaries and tool output. */
export type PermissionToolCall = { name: string; input: unknown };
export type PermissionUserTurn = { id: string; text: string; precedingToolCalls?: PermissionToolCall[] };

type ContextMessage = {
  type: string;
  uuid?: string;
  subtype?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  origin?: unknown;
  message?: { content?: unknown };
  attachment?: { type?: string; prompt?: unknown; isMeta?: boolean; origin?: unknown };
  compactMetadata?: { permissionUserTurns?: PermissionUserTurn[] };
};

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(b => b?.type === "text" && typeof b.text === "string")
    .map(b => b.text).join("\n");
}

export function collectPermissionUserTurns(messages: readonly ContextMessage[]): PermissionUserTurn[] {
  const turns = new Map<string, PermissionUserTurn>();
  let recentCalls: PermissionToolCall[] = [];
  for (const [index, msg] of messages.entries()) {
    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      const saved = msg.compactMetadata?.permissionUserTurns;
      for (const turn of Array.isArray(saved) ? saved : []) {
        if (typeof turn?.id === "string" && typeof turn?.text === "string") turns.set(turn.id, turn);
      }
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      const calls = msg.message.content.filter(b => b?.type === "tool_use" && typeof b.name === "string")
        .map(b => ({name: b.name, input: b.input}));
      recentCalls = [...recentCalls, ...calls].slice(-8);
      while (JSON.stringify(recentCalls).length > 8000) recentCalls.shift();
    }
    let text = "";
    if (msg.type === "user" && !msg.isMeta && !msg.isCompactSummary && !msg.origin) {
      text = textContent(msg.message?.content);
    } else if (msg.type === "attachment" && msg.attachment?.type === "queued_command" &&
      !msg.attachment.isMeta && !msg.attachment.origin) {
      text = textContent(msg.attachment.prompt);
    }
    if (text) {
      const id = msg.uuid ?? `turn-${index}`;
      if (!turns.has(id)) turns.set(id, { id, text, ...(recentCalls.length ? { precedingToolCalls: [...recentCalls] } : {}) });
      recentCalls = [];
    }
  }
  return [...turns.values()];
}

/** Persist the original evidence, never an LLM-authored approval summary. */
export function preservePermissionUserTurns<T extends { compactMetadata: object }>(boundary: T, messages: readonly ContextMessage[]): void {
  Object.assign(boundary.compactMetadata, { permissionUserTurns: collectPermissionUserTurns(messages) });
}

/** Tool churn cannot crowd user intent out of the classifier's context window. */
export function projectPermissionTranscript(transcript: string, budget = 48_000): {
  transcript: string;
  user_requests: string[];
  omitted_user_requests: number;
  user_request_context: { user: string; preceding_tool_calls: string[] }[];
} {
  const users: string[] = [];
  const tools: string[] = [];
  const contexts: { user: string; preceding_tool_calls: string[] }[] = [];
  let precedingTools: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry.user === "string" && Object.keys(entry).length === 1) {
        users.push(entry.user);
        if (precedingTools.length) contexts.push({user:entry.user, preceding_tool_calls:precedingTools});
        precedingTools = [];
      } else {
        tools.push(line);
        precedingTools = [...precedingTools, line].slice(-8);
        while (precedingTools.join("\n").length > 8000) precedingTools.shift();
      }
    } catch { /* Only harness-encoded JSONL is evidence. */ }
  }
  // Preserve the original task and newest human turns. Full originals remain
  // in the compact boundary on disk; this projection alone has a fixed budget.
  const selected: string[] = [];
  const keepOriginal = users.length > 1 && users[0]!.length <= budget / 4;
  let remaining = budget - (keepOriginal ? users[0]!.length : 0);
  for (let i = users.length - 1; i >= (keepOriginal ? 1 : 0); i--) {
    const text = users[i]!;
    if (text.length > remaining) break; // Never cut a revocation in half.
    selected.unshift(text);
    remaining -= text.length;
  }
  if (keepOriginal) selected.unshift(users[0]!);
  const recentTools: string[] = [];
  let toolBudget = 12_000;
  for (let i = tools.length - 1; i >= 0 && recentTools.length < 32; i--) {
    if (tools[i]!.length > toolBudget) break;
    recentTools.unshift(tools[i]!);
    toolBudget -= tools[i]!.length;
  }
  const selectedContexts = contexts.filter(c => selected.includes(c.user)).slice(-8);
  while (JSON.stringify(selectedContexts).length > 16_000) selectedContexts.shift();
  return {
    transcript: [...selected.map(user => JSON.stringify({ user })), ...recentTools].join("\n") + "\n",
    user_requests: selected,
    omitted_user_requests: users.length - selected.length,
    user_request_context: selectedContexts,
  };
}
