import { homedir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";
import { getPlatform } from "./platform.js";
import { execFileNoThrow } from "./execFileNoThrow.js";
import { logForDebugging } from "./debug.js";
import { logError } from "./log.js";
import { getErrnoCode } from "./errors.js";
import { which } from "./which.js";

/**
 * OS-level daily updater registration for `maximo --auto-update`.
 *
 * Covers users who rarely (or never) open the CLI interactively — the eager
 * startup check only runs when the CLI is launched, so a daily scheduled task
 * guarantees updates land even for long-absent users.
 *
 * Platforms:
 *   macOS  — launchd LaunchAgent (StartInterval: 86400s = daily)
 *   Linux  — user crontab entry (daily)
 *   WSL    — user crontab entry (WSL cron must be running; best-effort)
 *   Windows— schtasks.exe daily task (runs powershell/node wrapper)
 */

export const AUTO_UPDATE_AGENT_LABEL = "com.maximoai.maximo-syntax-updater";
export const AUTO_UPDATE_CRON_LINE = "maximo-syntax-auto-update";
export const AUTO_UPDATE_TASK_NAME = "MaximoSyntaxAutoUpdate";

function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${AUTO_UPDATE_AGENT_LABEL}.plist`);
}

/**
 * Resolve the executable to invoke in the scheduled task.
 *
 * Prefers a directly-executable `maximo` bin shim on PATH (npm global shim,
 * native binary, or ~/.maximo/local wrapper) so the scheduler doesn't need a
 * `node script.mjs` prefix. Falls back to getInvokedBinary() (which for a
 * bundled run returns the real binary path, and for a node-run script returns
 * the script path). Lazily imports doctorDiagnostic to avoid a cycle through
 * autoUpdater.
 */
async function resolveCliBinary(): Promise<string | null> {
  // 1) A runnable `maximo` shim on PATH is the most robust target.
  for (const name of ["maximo", "maximo-syntax", "maximo-syntax-cli"]) {
    const found = await which(name);
    if (found) return found;
  }

  // 2) Fall back to the invoked binary/script.
  const { getInvokedBinary } = await import("./doctorDiagnostic.js");
  const binary = getInvokedBinary();
  return binary && binary !== "unknown" ? binary : null;
}

async function registerMacos(): Promise<boolean> {
  const binary = await resolveCliBinary();
  if (!binary) return false;
  const plistPath = launchAgentPath();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AUTO_UPDATE_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binary}</string>
    <string>--auto-update</string>
  </array>
  <key>StartInterval</key>
  <integer>86400</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), "Library", "Logs", "maximo-syntax-updater.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), "Library", "Logs", "maximo-syntax-updater.log")}</string>
</dict>
</plist>
`;
  try {
    await writeFile(plistPath, plist, { encoding: "utf8" });
    // Load into launchd (best-effort; may fail if already loaded or in a
    // restricted context). Replacing an existing plist requires bootout first.
    const bootout = await execFileNoThrow(
      "launchctl",
      ["bootout", `gui/${process.getuid?.() ?? 501}`, plistPath],
      { useCwd: false },
    );
    if (bootout.code !== 0 && !String(bootout.stderr ?? "").includes("Could not find")) {
      logForDebugging(`launchctl bootout non-fatal: ${bootout.stderr}`);
    }
    let load = await execFileNoThrow(
      "launchctl",
      ["bootstrap", `gui/${process.getuid?.() ?? 501}`, plistPath],
      { useCwd: false },
    );
    if (load.code !== 0) {
      // Fall back to legacy load subcommand for older launchd.
      load = await execFileNoThrow("launchctl", ["load", plistPath], {
        useCwd: false,
      });
    }
    if (load.code !== 0) {
      logForDebugging(
        `launchctl load failed (plist written anyway): ${load.stderr}`,
      );
    }
    return true;
  } catch (error) {
    logError(error as Error);
    return false;
  }
}

async function unregisterMacos(): Promise<void> {
  const plistPath = launchAgentPath();
  try {
    await execFileNoThrow(
      "launchctl",
      ["bootout", `gui/${process.getuid?.() ?? 501}`, plistPath],
      { useCwd: false },
    );
  } catch (error) {
    logForDebugging(`launchctl bootout failed during unregister: ${error}`);
  }
  try {
    await unlink(plistPath);
  } catch (error) {
    const code = getErrnoCode(error);
    if (code !== "ENOENT") logForDebugging(`Failed to remove launch agent: ${error}`);
  }
}

function cronLine(binary: string): string {
  // Daily at a semi-random stable minute (based on a hash of the label) to
  // avoid every user's task firing at the same instant.
  const minute = (AUTO_UPDATE_AGENT_LABEL.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 60);
  return `# maximo-syntax-auto-update\n${minute} 3 * * * "${binary}" --auto-update >/dev/null 2>&1`;
}

async function getCrontab(): Promise<string[]> {
  const result = await execFileNoThrow("crontab", ["-l"], { useCwd: false });
  if (result.code !== 0) return [];
  return (result.stdout ?? "").split("\n");
}

async function setCrontab(lines: string[]): Promise<boolean> {
  const result = await execFileNoThrow("crontab", ["-"], {
    useCwd: false,
    input: lines.join("\n") + "\n",
  });
  return result.code === 0;
}

async function registerLinux(): Promise<boolean> {
  const binary = await resolveCliBinary();
  if (!binary) return false;
  try {
    const lines = await getCrontab();
    // Remove any existing entry, then append fresh.
    const filtered = lines.filter((l) => !l.includes(AUTO_UPDATE_CRON_LINE));
    const newLine = cronLine(binary);
    const result = await setCrontab([...filtered, newLine]);
    if (!result) {
      logForDebugging("Failed to write crontab entry for auto-update");
      return false;
    }
    return true;
  } catch (error) {
    logError(error as Error);
    return false;
  }
}

async function unregisterLinux(): Promise<void> {
  try {
    const lines = await getCrontab();
    const filtered = lines.filter((l) => !l.includes(AUTO_UPDATE_CRON_LINE));
    if (filtered.length !== lines.length) {
      await setCrontab(filtered);
    }
  } catch (error) {
    logForDebugging(`Failed to remove crontab entry: ${error}`);
  }
}

async function registerWindows(): Promise<boolean> {
  const binary = await resolveCliBinary();
  if (!binary) return false;
  // schtasks requires a single command; wrap the node binary invocation.
  const command = `"${binary}" --auto-update`;
  const result = await execFileNoThrow(
    "schtasks.exe",
    [
      "/Create",
      "/TN",
      AUTO_UPDATE_TASK_NAME,
      "/TR",
      command,
      "/SC",
      "DAILY",
      "/ST",
      "03:00",
      "/F",
    ],
    { useCwd: false },
  );
  if (result.code !== 0) {
    logForDebugging(`schtasks /Create failed: ${result.stderr}`);
    return false;
  }
  return true;
}

async function unregisterWindows(): Promise<void> {
  await execFileNoThrow("schtasks.exe", ["/Delete", "/TN", AUTO_UPDATE_TASK_NAME, "/F"], {
    useCwd: false,
  });
}

export async function registerAutoUpdateScheduler(): Promise<boolean> {
  const platform = getPlatform();
  try {
    switch (platform) {
      case "macos":
        return await registerMacos();
      case "linux":
      case "wsl":
        return await registerLinux();
      case "windows":
        return await registerWindows();
      default:
        return false;
    }
  } catch (error) {
    logError(error as Error);
    return false;
  }
}

export async function unregisterAutoUpdateScheduler(): Promise<void> {
  const platform = getPlatform();
  try {
    switch (platform) {
      case "macos":
        await unregisterMacos();
        break;
      case "linux":
      case "wsl":
        await unregisterLinux();
        break;
      case "windows":
        await unregisterWindows();
        break;
      default:
        break;
    }
  } catch (error) {
    logError(error as Error);
  }
}
