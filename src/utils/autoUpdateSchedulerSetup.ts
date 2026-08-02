import { getGlobalConfig, saveGlobalConfig, isAutoUpdaterDisabled } from "./config.js";
import {
  registerAutoUpdateScheduler,
  unregisterAutoUpdateScheduler,
} from "./autoUpdateScheduler.js";
import { logForDebugging } from "./debug.js";

/**
 * Best-effort reconciliation of the OS-level daily auto-update scheduler with
 * the current auto-update preference. Called once per startup (from
 * startDeferredPrefetches), after the eager update check:
 *
 *  - auto-updates enabled  → register the daily task (idempotent; guarded by
 *    config.autoUpdateSchedulerRegistered so it only runs once).
 *  - auto-updates disabled → unregister any previously-registered task.
 *
 * Registration is never fatal: failures are logged and the CLI proceeds.
 */
export async function reconcileAutoUpdateScheduler(): Promise<void> {
  const disabled = isAutoUpdaterDisabled();
  const config = getGlobalConfig();

  if (disabled) {
    // Auto-updates are off: if we previously registered a scheduler, remove it.
    if (config.autoUpdateSchedulerRegistered) {
      logForDebugging("autoUpdateScheduler: disabled, unregistering scheduler");
      await unregisterAutoUpdateScheduler();
      saveGlobalConfig((current) => ({
        ...current,
        autoUpdateSchedulerRegistered: false,
      }));
    }
    return;
  }

  // Auto-updates are on.
  if (config.autoUpdateSchedulerRegistered) {
    return; // already registered in a previous session
  }

  logForDebugging("autoUpdateScheduler: registering daily auto-update task");
  const ok = await registerAutoUpdateScheduler();
  if (ok) {
    saveGlobalConfig((current) => ({
      ...current,
      autoUpdateSchedulerRegistered: true,
    }));
  } else {
    logForDebugging("autoUpdateScheduler: registration failed (will retry next startup)");
  }
}
