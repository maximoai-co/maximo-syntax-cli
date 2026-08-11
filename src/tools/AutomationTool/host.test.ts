import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { callAutomationHost, getAutomationHostEnvironment } from "./host.js";

const temporaryPaths: string[] = [];
const servers: Server[] = [];
let pathSequence = 0;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function mockHost(handler: (request: Record<string, unknown>) => unknown, errorMessage?: string) {
  const directory = join(tmpdir(), `mauto-${process.pid}-${pathSequence++}`);
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\maximo-automation-test-${crypto.randomUUID()}` : join(directory, "host.sock");
  if (process.platform !== "win32") {
    temporaryPaths.push(directory);
    await mkdir(directory, { recursive: true });
  }
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      const response = handler(request);
      socket.end(`${JSON.stringify(errorMessage
        ? { id: request.id, ok: false, error: { message: errorMessage } }
        : { id: request.id, ok: true, result: response })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipe, () => resolve());
  });
  servers.push(server);
  return { pipe, capability: "test-capability", threadId: "thread-1", projectId: "project-1", workspaceRoot: "/workspace" };
}

test("automation host environment is enabled only with both capability fields", () => {
  expect(getAutomationHostEnvironment({})).toBeNull();
  expect(getAutomationHostEnvironment({ MAXIMO_SYNTAX_AUTOMATION_HOST_PIPE: "/tmp/host" })).toBeNull();
  expect(getAutomationHostEnvironment({
    MAXIMO_SYNTAX_AUTOMATION_HOST_PIPE: "/tmp/host",
    MAXIMO_SYNTAX_AUTOMATION_HOST_CAPABILITY: "secret",
    MAXIMO_SYNTAX_DESKTOP_PROJECT_ID: "project-1",
  })).toEqual({ pipe: "/tmp/host", capability: "secret", projectId: "project-1", threadId: undefined, workspaceRoot: undefined });
});

test("forwards scoped context and returns the desktop result", async () => {
  const host = await mockHost((request) => {
    expect(request.capability).toBe("test-capability");
    expect(request.action).toBe("list");
    expect(request.context).toEqual({ threadId: "thread-1", projectId: "project-1", workspaceRoot: "/workspace" });
    return { automations: [{ id: "automation-1" }] };
  });
  await expect(callAutomationHost("list", {}, host)).resolves.toEqual({ automations: [{ id: "automation-1" }] });
});

test("surfaces a rejected desktop request as a tool error", async () => {
  const host = await mockHost(() => ({ unused: true }), "Automation not found.");
  await expect(callAutomationHost("get", { automation_id: "missing" }, host)).rejects.toThrow("Automation not found.");
});
