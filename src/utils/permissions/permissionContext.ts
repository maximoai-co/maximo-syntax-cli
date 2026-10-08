/** Verbatim human turns, kept separately from model summaries and tool output. */
export type PermissionToolCall = { name: string; input: unknown };
export type PermissionEvidence =
  | ({ type: "tool_use" } & PermissionToolCall)
  | { type: "assistant_text"; text: string }
  | { type: "tool_result"; tool_name?: string; content: string; is_error?: boolean };
export type PermissionUserTurn = { id: string; text: string; precedingToolCalls?: PermissionToolCall[]; precedingContext?: PermissionEvidence[] };

type ContextMessage = {
  type: string;
  uuid?: string;
  subtype?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  origin?: unknown;
  message?: { content?: unknown };
  attachment?: { type?: string; prompt?: unknown; isMeta?: boolean; origin?: unknown };
  compactMetadata?: { permissionUserTurns?: PermissionUserTurn[]; permissionRecentEvidence?: PermissionEvidence[] };
};

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(b => b?.type === "text" && typeof b.text === "string")
    .map(b => b.text).join("\n");
}

// Keep prose independently of tool churn: an approval can refer to a draft
// proposed many tool calls ago. Observations remain untrusted, bounded evidence.
function boundEvidence(evidence: PermissionEvidence[]): PermissionEvidence[] {
  const limits = { assistant_text: 4, tool_use: 8, tool_result: 8 };
  const counts = { assistant_text: 0, tool_use: 0, tool_result: 0 };
  const kept = evidence.filter(e => e && e.type in limits).reverse().filter(e => ++counts[e.type] <= limits[e.type]).reverse();
  while (JSON.stringify(kept).length > 20_000) {
    const observation = kept.findIndex(e => e.type !== "assistant_text");
    kept.splice(observation < 0 ? 0 : observation, 1);
  }
  return kept;
}

export function collectPermissionContext(messages: readonly ContextMessage[]): { turns: PermissionUserTurn[]; recentEvidence: PermissionEvidence[] } {
  const turns = new Map<string, PermissionUserTurn>();
  let recentCalls: PermissionToolCall[] = [];
  let evidence: PermissionEvidence[] = [];
  const callNames = new Map<string, string>();
  for (const [index, msg] of messages.entries()) {
    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      const saved = msg.compactMetadata?.permissionUserTurns;
      for (const turn of Array.isArray(saved) ? saved : []) {
        if (typeof turn?.id === "string" && typeof turn?.text === "string") turns.set(turn.id, turn);
      }
      evidence = boundEvidence(msg.compactMetadata?.permissionRecentEvidence ?? []);
      recentCalls = evidence.filter((e): e is PermissionEvidence & PermissionToolCall => e.type === "tool_use").map(({name,input}) => ({name,input}));
    }
    if (msg.type === "assistant") {
      const prose = textContent(msg.message?.content);
      if (prose) evidence.push({type:"assistant_text",text:prose.slice(0, 6000)});
      if (Array.isArray(msg.message?.content)) for (const b of msg.message.content) {
        if (b?.type !== "tool_use" || typeof b.name !== "string") continue;
        if (typeof b.id === "string") callNames.set(b.id, b.name);
        const call = {name:b.name, input:b.input};
        recentCalls = [...recentCalls, call].slice(-8);
        while (JSON.stringify(recentCalls).length > 8000) recentCalls.shift();
        if (JSON.stringify(call).length <= 8000) evidence.push({type:"tool_use",...call});
      }
    }
    if (msg.type === "user" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b?.type !== "tool_result") continue;
        const content = textContent(b.content);
        if (content) evidence.push({type:"tool_result",tool_name:callNames.get(b.tool_use_id),content:content.slice(0, 6000),...(b.is_error ? {is_error:true} : {})});
      }
    }
    evidence = boundEvidence(evidence);
    let text = "";
    if (msg.type === "user" && !msg.isMeta && !msg.isCompactSummary && !msg.origin) {
      text = textContent(msg.message?.content);
    } else if (msg.type === "attachment" && msg.attachment?.type === "queued_command" &&
      !msg.attachment.isMeta && !msg.attachment.origin) {
      text = textContent(msg.attachment.prompt);
    }
    if (text) {
      const id = msg.uuid ?? `turn-${index}`;
      if (!turns.has(id)) turns.set(id, { id, text, ...(recentCalls.length ? { precedingToolCalls: [...recentCalls] } : {}), ...(evidence.length ? {precedingContext:[...evidence]} : {}) });
      recentCalls = [];
      evidence = [];
    }
  }
  return { turns:[...turns.values()], recentEvidence:evidence };
}

export function collectPermissionUserTurns(messages: readonly ContextMessage[]): PermissionUserTurn[] {
  return collectPermissionContext(messages).turns;
}

/** Persist the original evidence, never an LLM-authored approval summary. */
export function preservePermissionUserTurns<T extends { compactMetadata: object }>(boundary: T, messages: readonly ContextMessage[]): void {
  const context = collectPermissionContext(messages);
  Object.assign(boundary.compactMetadata, { permissionUserTurns: context.turns, permissionRecentEvidence: context.recentEvidence });
}

/** Tool churn cannot crowd user intent out of the classifier's context window. */
export function projectPermissionTranscript(transcript: string, budget = 48_000): {
  transcript: string;
  user_requests: string[];
  omitted_user_requests: number;
  user_request_context: { user: string; preceding_tool_calls: string[]; preceding_observations?: string[] }[];
} {
  const users: string[] = [];
  const tools: string[] = [];
  const contexts: { user: string; preceding_tool_calls: string[]; preceding_observations?: string[] }[] = [];
  let precedingTools: string[] = [];
  let precedingObservations: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry.user === "string" && Object.keys(entry).length === 1) {
        users.push(entry.user);
        if (precedingTools.length || precedingObservations.length) contexts.push({user:entry.user, preceding_tool_calls:precedingTools,...(precedingObservations.length ? {preceding_observations:precedingObservations} : {})});
        precedingTools = [];
        precedingObservations = [];
      } else {
        tools.push(line);
        if (entry.untrusted_observation) {
          precedingObservations = [...precedingObservations, line].slice(-8);
          while (precedingObservations.join("\n").length > 16_000) precedingObservations.shift();
        } else {
          precedingTools = [...precedingTools, line].slice(-8);
          while (precedingTools.join("\n").length > 8000) precedingTools.shift();
        }
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
  while (JSON.stringify(selectedContexts).length > 16_000) {
    if (selectedContexts.length > 1) selectedContexts.shift();
    else if (selectedContexts[0]?.preceding_tool_calls.length) selectedContexts[0].preceding_tool_calls.shift();
    else if ((selectedContexts[0]?.preceding_observations?.length ?? 0) > 1) selectedContexts[0]!.preceding_observations!.shift();
    else selectedContexts.shift();
  }
  return {
    transcript: [...selected.map(user => JSON.stringify({ user })), ...recentTools].join("\n") + "\n",
    user_requests: selected,
    omitted_user_requests: users.length - selected.length,
    user_request_context: selectedContexts,
  };
}
