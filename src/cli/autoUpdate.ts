import {
  checkAndInstallUpdate,
  getCurrentRealVersion,
} from "../utils/autoUpdater.js";
import { logForDebugging } from "../utils/debug.js";
import { logError } from "../utils/log.js";
import { getPlatform } from "../utils/platform.js";
import { execFileNoThrow } from "../utils/execFileNoThrow.js";

const NOTIF_TITLE = "Maximo Syntax";

/**
 * Send a native OS notification (no terminal available in the scheduler
 * context). Best-effort: failures are logged, never thrown.
 */
async function sendOsNotification(message: string): Promise<void> {
  const platform = getPlatform();
  try {
    if (platform === "macos") {
      // macOS: AppleScript display notification (no terminal needed).
      const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${NOTIF_TITLE}"`;
      await execFileNoThrow("osascript", ["-e", script], { useCwd: false });
    } else if (platform === "linux" || platform === "wsl") {
      // Linux: libnotify (notify-send). WSL has no native notifications; the
      // Windows host toast would need a different path, so this is best-effort.
      await execFileNoThrow("notify-send", [NOTIF_TITLE, message], {
        useCwd: false,
      });
    } else if (platform === "windows") {
      // Windows: PowerShell toast via BurntToast if installed, else fall back
      // to a msg.exe popup (available on all Windows versions).
      const script = `New-BurntToastNotification -Text "${message.replace(/"/g, '`"')}"`;
      const result = await execFileNoThrow(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        { useCwd: false },
      );
      if (result.code !== 0) {
        await execFileNoThrow(
          "msg.exe",
          ["*", `/TIME:10`, `${NOTIF_TITLE}: ${message}`],
          { useCwd: false },
        );
      }
    }
  } catch (error) {
    logError(error as Error);
  }
}

/**
 * Headless auto-update check invoked by the OS scheduler
 * (`maximo --auto-update`). Runs the shared update engine and surfaces the
 * result via an OS notification when an update was installed.
 */
export async function runAutoUpdateCheck(): Promise<void> {
  logForDebugging("autoUpdate: running background auto-update check");

  const runningVersion = getCurrentRealVersion();

  // force: true bypasses the hourly cooldown so the OS scheduler (running at
  // most once per day) always performs a fresh check. The engine still applies
  // all the safety gates (auto-update disabled, max-version kill switch,
  // min-version skip, lock file, installation-type dispatch).
  const result = await checkAndInstallUpdate({ force: true });

  if (!result) {
    return;
  }

  if (result.status === "success" && result.version) {
    // The engine reports the running version when nothing was installed
    // (up-to-date, native-deferred, max-version skip) and the NEW version only
    // after a real install. So version !== runningVersion ⇔ an update happened.
    if (result.version !== runningVersion) {
      await sendOsNotification(
        `Updated to v${result.version}. Restart the CLI to use it.`,
      );
    }
  } else if (result.status === "install_failed" || result.status === "no_permissions") {
    await sendOsNotification(
      "An update was available but could not be installed. Run `maximo update` or `maximo doctor`.",
    );
  }
}
