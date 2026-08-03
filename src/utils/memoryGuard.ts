import { unlink, writeFile } from "fs/promises";
import { getMaximoConfigHomeDir } from "./envUtils.js";
import { getErrnoCode, isENOENT } from "./errors.js";
import { getFsImplementation } from "./fsOperations.js";
import { logForDiagnosticsNoPII } from "./diagLogs.js";
import { logForDebugging } from "./debug.js";

/**
 * Proactive heap monitor for long-running interactive sessions.
 *
 * The default Node/V8 heap ceiling (~2GB) is easy to reach when a session has
 * been open for hours: the live transcript, tool results, and render tree all
 * accumulate in memory. When V8 hits the ceiling it throws a fatal
 * "heap out of memory" that kills the process regardless of the
 * uncaughtException/unhandledRejection handlers — the classic "CLI was open
 * for hours then died" failure.
 *
 * This guard polls heap usage and, before that fatal point, takes bounded
 * actions:
 *   - "high"  (>= 1.5GB): log a marker (diagnostic visibility only).
 *   - "critical" (>= 2.5GB): run global.gc() if exposed, and write a crash
 *     marker file so a subsequent start can warn "previous session ran low on
 *     memory — consider /compact or /clear".
 *   - "extreme" (>= 3.5GB): same as critical but with a stronger marker; the
 *     process is approaching the ceiling, so the user gets the strongest hint
 *     to compact/clear before the fatal OOM.
 *
 * Deliberately does NOT force-compact the conversation: compaction requires
 * the active model + messages + tool context and is owned by the query loop.
 * Forcing it from a timer could corrupt an in-flight session. The guard's job
 * is to surface the danger and record it, not to mutate session state.
 */

const HIGH_MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024; // 1.5GB
const CRITICAL_MEMORY_THRESHOLD = 2.5 * 1024 * 1024 * 1024; // 2.5GB
const EXTREME_MEMORY_THRESHOLD = 3.5 * 1024 * 1024 * 1024; // 3.5GB
const POLL_INTERVAL_MS = 15_000;
const CRASH_MARKER_FILENAME = "memory-pressure-marker.txt";

type MemoryLevel = "normal" | "high" | "critical" | "extreme";

let lastLevel: MemoryLevel = "normal";
let started = false;

function crashMarkerPath(): string {
  return joinPath(getMaximoConfigHomeDir(), CRASH_MARKER_FILENAME);
}

// Small local join to avoid pulling in path module at module scope.
function joinPath(...parts: string[]): string {
  return parts.join("/");
}

function getHeapLevel(heapUsed: number): MemoryLevel {
  if (heapUsed >= EXTREME_MEMORY_THRESHOLD) return "extreme";
  if (heapUsed >= CRITICAL_MEMORY_THRESHOLD) return "critical";
  if (heapUsed >= HIGH_MEMORY_THRESHOLD) return "high";
  return "normal";
}

async function writeCrashMarker(level: MemoryLevel, heapUsed: number): Promise<void> {
  try {
    const path = crashMarkerPath();
    const content = JSON.stringify({
      level,
      heapUsed,
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });
    await writeFile(path, content, { encoding: "utf8" });
  } catch (error) {
    logForDebugging(`memoryGuard: failed to write marker: ${error}`, {
      level: "error",
    });
  }
}

async function clearCrashMarker(): Promise<void> {
  try {
    await unlink(crashMarkerPath());
  } catch (error) {
    const code = getErrnoCode(error);
    if (code !== "ENOENT") {
      logForDebugging(`memoryGuard: failed to clear marker: ${error}`, {
        level: "error",
      });
    }
  }
}

/** Read the memory-pressure marker (present iff the last session ran low on memory). */
export async function readMemoryPressureMarker(): Promise<{
  level: string;
  heapUsed: number;
  timestamp: string;
} | null> {
  try {
    const content = await getFsImplementation().readFile(crashMarkerPath(), {
      encoding: "utf8",
    });
    const parsed = JSON.parse(content) as {
      level?: string;
      heapUsed?: number;
      timestamp?: string;
    };
    if (!parsed.level) return null;
    return {
      level: parsed.level,
      heapUsed: parsed.heapUsed ?? 0,
      timestamp: parsed.timestamp ?? "",
    };
  } catch (error) {
    const code = getErrnoCode(error);
    if (code !== "ENOENT") {
      logForDebugging(`memoryGuard: failed to read marker: ${error}`, {
        level: "error",
      });
    }
    return null;
  }
}

function runGc(): void {
  try {
    const g = globalThis as unknown as { gc?: () => void };
    if (typeof g.gc === "function") {
      g.gc();
    }
  } catch {
    // gc() can throw in some runtimes; never let it break the poll loop.
  }
}

function poll(): void {
  try {
    const heapUsed = process.memoryUsage().heapUsed;
    const level = getHeapLevel(heapUsed);

    // Only act on level *transitions* upward, so we don't spam markers/logs
    // every 15s while a session sits at a high plateau.
    const levelIndex = ["normal", "high", "critical", "extreme"].indexOf(level);
    const lastIndex = ["normal", "high", "critical", "extreme"].indexOf(lastLevel);

    if (levelIndex > lastIndex) {
      logForDiagnosticsNoPII("warn", "memory_pressure", {
        level,
        heap_used: heapUsed,
        heap_total: process.memoryUsage().heapTotal,
        uptime_s: Math.floor(process.uptime()),
      });

      if (level === "critical" || level === "extreme") {
        runGc();
        void writeCrashMarker(level, heapUsed);
      }
      lastLevel = level;
    }
  } catch (error) {
    logForDebugging(`memoryGuard: poll failed: ${error}`, { level: "error" });
  }
}

/**
 * Start the heap monitor. Idempotent. Unrefs the timer so it never keeps the
 * process alive on its own. Safe to call in any build (no ant-only gating —
 * open builds are exactly where the default heap ceiling bites).
 */
export function startMemoryGuard(): void {
  if (started) return;
  started = true;

  // Clear any stale marker from a previous run at startup so a fresh, healthy
  // session never warns about an old one. Best-effort.
  void clearCrashMarker();

  const timer = setInterval(poll, POLL_INTERVAL_MS);
  timer.unref?.();
  // Fire once immediately so a session already over threshold is caught fast.
  poll();
}
