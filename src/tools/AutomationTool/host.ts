import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

interface AutomationHostResponse {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string } | string;
}

export interface AutomationHostEnvironment {
  pipe: string;
  capability: string;
  threadId?: string;
  projectId?: string;
  workspaceRoot?: string;
}

function safeErrorMessage(error: AutomationHostResponse["error"]): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message.trim() || "The desktop automation host rejected the request.";
  }
  return "The desktop automation host rejected the request.";
}

export function getAutomationHostEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): AutomationHostEnvironment | null {
  const pipe = environment.MAXIMO_SYNTAX_AUTOMATION_HOST_PIPE?.trim();
  const capability = environment.MAXIMO_SYNTAX_AUTOMATION_HOST_CAPABILITY?.trim();
  if (!pipe || !capability) return null;
  return {
    pipe,
    capability,
    threadId: environment.MAXIMO_SYNTAX_DESKTOP_THREAD_ID?.trim() || undefined,
    projectId: environment.MAXIMO_SYNTAX_DESKTOP_PROJECT_ID?.trim() || undefined,
    workspaceRoot: environment.MAXIMO_SYNTAX_DESKTOP_WORKSPACE_ROOT?.trim() || undefined,
  };
}

export async function callAutomationHost(
  action: string,
  argumentsValue: Record<string, unknown>,
  host = getAutomationHostEnvironment()
): Promise<unknown> {
  if (!host) {
    throw new Error(
      "Automations are only available while Maximo Syntax is running inside the desktop app."
    );
  }

  const requestId = randomUUID();
  const request = JSON.stringify({
    id: requestId,
    capability: host.capability,
    action,
    arguments: argumentsValue,
    context: {
      threadId: host.threadId,
      projectId: host.projectId,
      workspaceRoot: host.workspaceRoot,
    },
  });

  return new Promise((resolve, reject) => {
    const socket = createConnection(host.pipe);
    let settled = false;
    let responseText = "";

    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    const timeout = setTimeout(() => {
      finish(new Error("The desktop automation host did not respond in time."));
    }, REQUEST_TIMEOUT_MS);

    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${request}\n`));
    socket.on("data", (chunk: string) => {
      responseText += chunk;
      if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) {
        finish(new Error("The desktop automation response was too large."));
        return;
      }
      const newline = responseText.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(responseText.slice(0, newline)) as AutomationHostResponse;
        if (response.id !== requestId) {
          finish(new Error("The desktop automation host returned a mismatched response."));
        } else if (response.ok === false || response.error) {
          finish(new Error(safeErrorMessage(response.error)));
        } else {
          finish(undefined, response.result);
        }
      } catch (error) {
        finish(
          new Error(
            error instanceof Error
              ? `Invalid response from the desktop automation host: ${error.message}`
              : "Invalid response from the desktop automation host."
          )
        );
      }
    });
    socket.on("error", (error) => {
      finish(new Error(`Could not reach the desktop automation host: ${error.message}`));
    });
    socket.on("close", () => {
      if (!settled) finish(new Error("The desktop automation host closed the connection."));
    });
  });
}
