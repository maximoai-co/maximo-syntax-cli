import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { callAutomationHost, getAutomationHostEnvironment } from "./host.js";

const actionSchema = z.enum([
  "create",
  "list",
  "get",
  "update",
  "pause",
  "resume",
  "delete",
  "run_now",
  "list_runs",
  "cancel_run",
  "mark_runs_read",
]);

const scheduleSchema = z
  .strictObject({
    type: z.enum(["manual", "once", "interval", "daily", "weekdays", "weekly", "cron"]),
    run_at: z.string().optional().describe("ISO timestamp for a one-time automation."),
    every_minutes: z.number().int().min(1).max(525_600).optional(),
    time_of_day: z.string().optional().describe('Local 24-hour time such as "09:00".'),
    day_of_week: z.number().int().min(0).max(6).optional().describe("0 is Sunday and 6 is Saturday."),
    expression: z.string().optional().describe("Standard five-field cron expression."),
    timezone: z.string().optional().describe('IANA timezone such as "Africa/Lagos".'),
  })
  .optional();

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: actionSchema.describe("The automation operation to perform."),
    automation_id: z.string().optional(),
    run_id: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Run-history page size for list_runs. Defaults to 50."),
    offset: z.number().int().min(0).max(1_000).optional().describe("Run-history offset for list_runs. Defaults to 0."),
    name: z.string().max(160).optional(),
    description: z.string().max(2_000).optional(),
    prompt: z.string().max(100_000).optional(),
    schedule: scheduleSchema,
    destination: z.enum(["new_chat", "dedicated_chat", "existing_chat"]).optional(),
    thread_id: z.string().optional().describe("Required when destination is existing_chat."),
    model: z.string().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    permission_mode: z.enum(["default", "acceptEdits", "auto", "full", "bypassPermissions", "plan"]).optional()
      .describe("Desktop permission policy. full and bypassPermissions both grant unrestricted command access."),
    workspace_mode: z.enum(["auto", "local", "worktree"]).optional(),
    allow_local_fallback: z.boolean().optional(),
    notification_policy: z.enum(["all", "failures_only", "none"]).optional(),
    max_runtime_minutes: z.number().int().min(1).max(1_440).optional(),
    enabled: z.boolean().optional(),
  })
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: actionSchema,
    result: z.unknown().optional(),
  })
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type AutomationToolOutput = z.infer<OutputSchema>;

const MUTATING_ACTIONS = new Set([
  "create",
  "update",
  "pause",
  "resume",
  "delete",
  "run_now",
  "cancel_run",
  "mark_runs_read",
]);

export const AutomationTool = buildTool({
  name: "Automation",
  searchHint: "schedule manage background recurring work",
  shouldDefer: true,
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  isEnabled() {
    return getAutomationHostEnvironment() !== null;
  },
  isConcurrencySafe(input) {
    return !MUTATING_ACTIONS.has(input.action);
  },
  isReadOnly(input) {
    return !MUTATING_ACTIONS.has(input.action);
  },
  isDestructive(input) {
    return input.action === "delete" || input.action === "cancel_run";
  },
  toAutoClassifierInput(input) {
    return `${input.action}: ${input.name ?? input.automation_id ?? input.run_id ?? "automations"}`;
  },
  async description() {
    return "Create and fully manage persistent desktop automations. Automations can run once, on an interval, daily, on weekdays, weekly, or from a five-field cron schedule; run in a new, dedicated, or existing chat; use the project checkout or an isolated git worktree; and keep durable run history. Use this only when the user explicitly asks to schedule or manage future/background work. Never silently turn an ordinary request into an automation.";
  },
  async prompt() {
    return `Use Automation when the user explicitly asks to schedule, repeat, pause, resume, inspect, run, or delete background work in Maximo Syntax Desktop.

For create, provide name, prompt, and schedule. The current desktop project is used automatically. Default to destination=new_chat and workspace_mode=auto unless the user says otherwise. Use existing_chat only with a thread_id. Preserve the user's timezone intent; use an IANA timezone. Use action=list or list_runs before changing an ambiguous automation; list returns compact prompt previews, while get returns the complete definition. Paginate list_runs with limit and offset when needed. You may edit an automation that is currently executing, including this automation, when the user's request requires it. Never create an automation merely because work could be repeated.`;
  },
  async validateInput(input) {
    if (input.action === "create" && (!input.name?.trim() || !input.prompt?.trim() || !input.schedule)) {
      return {
        result: false,
        message: "create requires name, prompt, and schedule",
        errorCode: 1,
      };
    }
    if (["get", "update", "pause", "resume", "delete", "run_now", "list_runs", "mark_runs_read"].includes(input.action) && !input.automation_id) {
      return {
        result: false,
        message: `${input.action} requires automation_id`,
        errorCode: 2,
      };
    }
    if (input.action === "cancel_run" && !input.run_id) {
      return { result: false, message: "cancel_run requires run_id", errorCode: 3 };
    }
    if (input.destination === "existing_chat" && !input.thread_id) {
      return {
        result: false,
        message: "destination=existing_chat requires thread_id",
        errorCode: 4,
      };
    }
    return { result: true };
  },
  renderToolUseMessage() {
    return null;
  },
  async call(input) {
    const { action, ...argumentsValue } = input;
    const result = await callAutomationHost(action, argumentsValue);
    return { data: { success: true, action, result } };
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: JSON.stringify(output.result ?? { success: output.success }, null, 2),
    };
  },
} satisfies ToolDef<InputSchema, AutomationToolOutput>);
