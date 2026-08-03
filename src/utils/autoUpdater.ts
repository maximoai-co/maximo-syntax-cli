import axios from "axios";
import { createHash } from "crypto";
import { constants as fsConstants } from "fs";
import { access, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import {
  getDynamicConfig_BLOCKS_ON_INIT,
  getDynamicConfig_CACHED_MAY_BE_STALE,
} from "src/services/analytics/growthbook.js";
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from "src/services/analytics/index.js";
import {
  type ReleaseChannel,
  getGlobalConfig,
  getOrCreateUserID,
  isAutoUpdaterDisabled,
  saveGlobalConfig,
} from "./config.js";
import { logForDebugging } from "./debug.js";
import { logForDiagnosticsNoPII } from "./diagLogs.js";
import { env } from "./env.js";
import { getMaximoConfigHomeDir } from "./envUtils.js";
import { MaximoError, getErrnoCode, isENOENT } from "./errors.js";
import { execFileNoThrowWithCwd } from "./execFileNoThrow.js";
import { getFsImplementation } from "./fsOperations.js";
import { gracefulShutdownSync } from "./gracefulShutdown.js";
import { logError } from "./log.js";
import { gt, gte, lt } from "./semver.js";
import { getInitialSettings } from "./settings/settings.js";
import {
  filterMaximoAliases,
  getShellConfigPaths,
  readFileLines,
  writeFileLines,
} from "./shellConfig.js";
import { jsonParse } from "./slowOperations.js";

const GCS_BUCKET_URL =
  "https://storage.googleapis.com/maximo-syntax-dist/maximo-syntax-releases";

class AutoUpdaterError extends MaximoError {}

export type InstallStatus =
  | "success"
  | "no_permissions"
  | "install_failed"
  | "in_progress";

/**
 * The real, user-facing package version used for update comparisons.
 *
 * MACRO.VERSION is the internal compatibility version (99.0.0 in open builds,
 * kept high to pass first-party minimum-version guards) — it is NOT the npm
 * package version and comparing it against the registry always looks
 * "up to date". MACRO.DISPLAY_VERSION carries the actual published version
 * (e.g. 0.1.20) and is what must be compared against npm's latest.
 */
export function getCurrentRealVersion(): string {
  return (MACRO as { DISPLAY_VERSION?: string }).DISPLAY_VERSION ?? MACRO.VERSION;
}

export type AutoUpdaterResult = {
  version: string | null;
  status: InstallStatus;
  notifications?: string[];
};

/**
 * Server-driven rollout config for staged auto-updates (Step 5).
 * Backend publishes this under the same GrowthBook config family as
 * tengu_version_config / tengu_max_version_config.
 *
 *  - rolloutPercent (0-100): fraction of users eligible for a given release.
 *    Cohort is sticky per (userID, targetVersion).
 *  - securityCutoffDate (ISO): after this date, securityMinVersion is forced.
 *  - securityMinVersion: the minimum version to force users onto after the
 *    cutoff (critical security patches). Bypasses the rollout gate and the
 *    user's autoUpdates opt-out, but still respects maxVersion (kill switch).
 */
export type UpdateRolloutConfig = {
  rolloutPercent?: number;
  securityCutoffDate?: string;
  securityMinVersion?: string;
};

async function getRolloutConfig(): Promise<UpdateRolloutConfig> {
  // Non-blocking read (disk-cache fallback) so the scheduler path never blocks.
  try {
    return getDynamicConfig_CACHED_MAY_BE_STALE<UpdateRolloutConfig>(
      "tengu_update_rollout_config",
      {},
    );
  } catch (error) {
    logError(error as Error);
    return {};
  }
}

/**
 * Deterministic, sticky cohort check. Hash(userID + ":" + targetVersion) → 0..99.
 * Including targetVersion keeps the cohort stable per release even as the
 * rollout percent rises, so users already selected for vX stay selected.
 */
export function isInRolloutCohort(
  rolloutPercent: number,
  targetVersion: string,
): boolean {
  const userID = getOrCreateUserID();
  const hash = createHash("sha256")
    .update(`${userID}:${targetVersion}`)
    .digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return bucket < rolloutPercent;
}

/**
 * Returns the version to force onto the user when a security patch is past its
 * cutoff date, or undefined when no force applies. Callers must still respect
 * the maxVersion kill switch (force never beats an incident pause).
 */
function getForcedSecurityVersion(
  config: UpdateRolloutConfig,
  currentVersion: string,
): string | undefined {
  if (!config.securityCutoffDate || !config.securityMinVersion) {
    return undefined;
  }
  const cutoff = Date.parse(config.securityCutoffDate);
  if (isNaN(cutoff) || Date.now() < cutoff) {
    return undefined;
  }
  // Only force when the user is actually behind the required minimum.
  if (lt(currentVersion, config.securityMinVersion)) {
    return config.securityMinVersion;
  }
  return undefined;
}

export type MaxVersionConfig = {
  external?: string;
  ant?: string;
  external_message?: string;
  ant_message?: string;
};

/**
 * Checks if the current version meets the minimum required version from Statsig config
 * Terminates the process with an error message if the version is too old
 *
 * NOTE ON SHA-BASED VERSIONING:
 * We use SemVer-compliant versioning with build metadata format (X.X.X+SHA) for continuous deployment.
 * According to SemVer specs, build metadata (the +SHA part) is ignored when comparing versions.
 *
 * Versioning approach:
 * 1. For version requirements/compatibility (assertMinVersion), we use semver comparison that ignores build metadata
 * 2. For updates ('maximo update'), we use exact string comparison to detect any change, including SHA
 *    - This ensures users always get the latest build, even when only the SHA changes
 *    - The UI clearly shows both versions including build metadata
 *
 * This approach keeps version comparison logic simple while maintaining traceability via the SHA.
 */
export async function assertMinVersion(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    const versionConfig = await getDynamicConfig_BLOCKS_ON_INIT<{
      minVersion: string;
    }>("tengu_version_config", { minVersion: "0.0.0" });

    if (
      versionConfig.minVersion &&
      lt(MACRO.VERSION, versionConfig.minVersion)
    ) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.error(`
It looks like your version of Maximo Syntax (${MACRO.VERSION}) needs an update.
A newer version (${versionConfig.minVersion} or higher) is required to continue.

To update, please run:
    maximo update

This will ensure you have access to the latest features and improvements.
`);
      gracefulShutdownSync(1);
    }
  } catch (error) {
    logError(error as Error);
  }
}

/**
 * Returns the maximum allowed version for the current user type.
 * For ants, returns the `ant` field (dev version format).
 * For external users, returns the `external` field (clean semver).
 * This is used as a server-side kill switch to pause auto-updates during incidents.
 * Returns undefined if no cap is configured.
 */
export async function getMaxVersion(): Promise<string | undefined> {
  const config = await getMaxVersionConfig();
  if (process.env.USER_TYPE === "ant") {
    return config.ant || undefined;
  }
  return config.external || undefined;
}

/**
 * Returns the server-driven message explaining the known issue, if configured.
 * Shown in the warning banner when the current version exceeds the max allowed version.
 */
export async function getMaxVersionMessage(): Promise<string | undefined> {
  const config = await getMaxVersionConfig();
  if (process.env.USER_TYPE === "ant") {
    return config.ant_message || undefined;
  }
  return config.external_message || undefined;
}

async function getMaxVersionConfig(): Promise<MaxVersionConfig> {
  try {
    return await getDynamicConfig_BLOCKS_ON_INIT<MaxVersionConfig>(
      "tengu_max_version_config",
      {}
    );
  } catch (error) {
    logError(error as Error);
    return {};
  }
}

/**
 * Checks if a target version should be skipped due to user's minimumVersion setting.
 * This is used when switching to stable channel - the user can choose to stay on their
 * current version until stable catches up, preventing downgrades.
 */
export function shouldSkipVersion(targetVersion: string): boolean {
  const settings = getInitialSettings();
  const minimumVersion = settings?.minimumVersion;
  if (!minimumVersion) {
    return false;
  }
  // Skip if target version is less than minimum
  const shouldSkip = !gte(targetVersion, minimumVersion);
  if (shouldSkip) {
    logForDebugging(
      `Skipping update to ${targetVersion} - below minimumVersion ${minimumVersion}`
    );
  }
  return shouldSkip;
}

// Lock file for auto-updater to prevent concurrent updates
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute timeout for locks

/**
 * Get the path to the lock file
 * This is a function to ensure it's evaluated at runtime after test setup
 */
export function getLockFilePath(): string {
  return join(getMaximoConfigHomeDir(), ".update.lock");
}

/**
 * Attempts to acquire a lock for auto-updater
 * @returns true if lock was acquired, false if another process holds the lock
 */
async function acquireLock(): Promise<boolean> {
  const fs = getFsImplementation();
  const lockPath = getLockFilePath();

  // Check for existing lock: 1 stat() on the happy path (fresh lock or ENOENT),
  // 2 on stale-lock recovery (re-verify staleness immediately before unlink).
  try {
    const stats = await fs.stat(lockPath);
    const age = Date.now() - stats.mtimeMs;
    if (age < LOCK_TIMEOUT_MS) {
      return false;
    }
    // Lock is stale, remove it before taking over. Re-verify staleness
    // immediately before unlinking to close a TOCTOU race: if two processes
    // both observe the stale lock, A unlinks + writes a fresh lock, then B
    // would unlink A's fresh lock and both believe they hold it. A fresh
    // lock has a recent mtime, so re-checking staleness makes B back off.
    try {
      const recheck = await fs.stat(lockPath);
      if (Date.now() - recheck.mtimeMs < LOCK_TIMEOUT_MS) {
        return false;
      }
      await fs.unlink(lockPath);
    } catch (err) {
      if (!isENOENT(err)) {
        logError(err as Error);
        return false;
      }
    }
  } catch (err) {
    if (!isENOENT(err)) {
      logError(err as Error);
      return false;
    }
    // ENOENT: no lock file, proceed to create one
  }

  // Create lock file atomically with O_EXCL (flag: 'wx'). If another process
  // wins the race and creates it first, we get EEXIST and back off.
  // Lazy-mkdir the config dir on ENOENT.
  try {
    await writeFile(lockPath, `${process.pid}`, {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (err) {
    const code = getErrnoCode(err);
    if (code === "EEXIST") {
      return false;
    }
    if (code === "ENOENT") {
      try {
        // fs.mkdir from getFsImplementation() is always recursive:true and
        // swallows EEXIST internally, so a dir-creation race cannot reach the
        // catch below — only writeFile's EEXIST (true lock contention) can.
        await fs.mkdir(getMaximoConfigHomeDir());
        await writeFile(lockPath, `${process.pid}`, {
          encoding: "utf8",
          flag: "wx",
        });
        return true;
      } catch (mkdirErr) {
        if (getErrnoCode(mkdirErr) === "EEXIST") {
          return false;
        }
        logError(mkdirErr as Error);
        return false;
      }
    }
    logError(err as Error);
    return false;
  }
}

/**
 * Releases the update lock if it's held by this process
 */
async function releaseLock(): Promise<void> {
  const fs = getFsImplementation();
  const lockPath = getLockFilePath();
  try {
    const lockData = await fs.readFile(lockPath, { encoding: "utf8" });
    if (lockData === `${process.pid}`) {
      await fs.unlink(lockPath);
    }
  } catch (err) {
    if (isENOENT(err)) {
      return;
    }
    logError(err as Error);
  }
}

async function getInstallationPrefix(): Promise<string | null> {
  // Run from home directory to avoid reading project-level .npmrc/.bunfig.toml
  const isBun = env.isRunningWithBun();
  let prefixResult = null;
  if (isBun) {
    prefixResult = await execFileNoThrowWithCwd("bun", ["pm", "bin", "-g"], {
      cwd: homedir(),
    });
  } else {
    prefixResult = await execFileNoThrowWithCwd(
      "npm",
      ["-g", "config", "get", "prefix"],
      { cwd: homedir() }
    );
  }
  if (prefixResult.code !== 0) {
    logError(new Error(`Failed to check ${isBun ? "bun" : "npm"} permissions`));
    return null;
  }
  return prefixResult.stdout.trim();
}

export async function checkGlobalInstallPermissions(): Promise<{
  hasPermissions: boolean;
  npmPrefix: string | null;
}> {
  try {
    const prefix = await getInstallationPrefix();
    if (!prefix) {
      return { hasPermissions: false, npmPrefix: null };
    }

    try {
      await access(prefix, fsConstants.W_OK);
      return { hasPermissions: true, npmPrefix: prefix };
    } catch {
      logError(
        new AutoUpdaterError("Insufficient permissions for global npm install.")
      );
      return { hasPermissions: false, npmPrefix: prefix };
    }
  } catch (error) {
    logError(error as Error);
    return { hasPermissions: false, npmPrefix: null };
  }
}

export async function getLatestVersion(
  channel: ReleaseChannel
): Promise<string | null> {
  const npmTag = channel === "stable" ? "stable" : "latest";

  // Run from home directory to avoid reading project-level .npmrc
  // which could be maliciously crafted to redirect to an attacker's registry
  const result = await execFileNoThrowWithCwd(
    "npm",
    ["view", `${MACRO.PACKAGE_URL}@${npmTag}`, "version", "--prefer-online"],
    { abortSignal: AbortSignal.timeout(5000), cwd: homedir() }
  );
  if (result.code !== 0) {
    logForDebugging(`npm view failed with code ${result.code}`);
    if (result.stderr) {
      logForDebugging(`npm stderr: ${result.stderr.trim()}`);
    } else {
      logForDebugging("npm stderr: (empty)");
    }
    if (result.stdout) {
      logForDebugging(`npm stdout: ${result.stdout.trim()}`);
    }
    return null;
  }
  return result.stdout.trim();
}

export type NpmDistTags = {
  latest: string | null;
  stable: string | null;
};

/**
 * Get npm dist-tags (latest and stable versions) from the registry.
 * This is used by the doctor command to show users what versions are available.
 */
export async function getNpmDistTags(): Promise<NpmDistTags> {
  // Run from home directory to avoid reading project-level .npmrc
  const result = await execFileNoThrowWithCwd(
    "npm",
    ["view", MACRO.PACKAGE_URL, "dist-tags", "--json", "--prefer-online"],
    { abortSignal: AbortSignal.timeout(5000), cwd: homedir() }
  );

  if (result.code !== 0) {
    logForDebugging(`npm view dist-tags failed with code ${result.code}`);
    return { latest: null, stable: null };
  }

  try {
    const parsed = jsonParse(result.stdout.trim()) as Record<string, unknown>;
    return {
      latest: typeof parsed.latest === "string" ? parsed.latest : null,
      stable: typeof parsed.stable === "string" ? parsed.stable : null,
    };
  } catch (error) {
    logForDebugging(`Failed to parse dist-tags: ${error}`);
    return { latest: null, stable: null };
  }
}

/**
 * Get the latest version from GCS bucket for a given release channel.
 * This is used by installations that don't have npm (e.g. package manager installs).
 */
export async function getLatestVersionFromGcs(
  channel: ReleaseChannel
): Promise<string | null> {
  try {
    const response = await axios.get(`${GCS_BUCKET_URL}/${channel}`, {
      timeout: 5000,
      responseType: "text",
    });
    return response.data.trim();
  } catch (error) {
    logForDebugging(`Failed to fetch ${channel} from GCS: ${error}`);
    return null;
  }
}

/**
 * Get available versions from GCS bucket (for native installations).
 * Fetches both latest and stable channel pointers.
 */
export async function getGcsDistTags(): Promise<NpmDistTags> {
  const [latest, stable] = await Promise.all([
    getLatestVersionFromGcs("latest"),
    getLatestVersionFromGcs("stable"),
  ]);

  return { latest, stable };
}

/**
 * Get version history from npm registry (ant-only feature)
 * Returns versions sorted newest-first, limited to the specified count
 *
 * Uses NATIVE_PACKAGE_URL when available because:
 * 1. Native installation is the primary installation method for ant users
 * 2. Not all JS package versions have corresponding native packages
 * 3. This prevents rollback from listing versions that don't have native binaries
 */
export async function getVersionHistory(limit: number): Promise<string[]> {
  if (process.env.USER_TYPE !== "ant") {
    return [];
  }

  // Use native package URL when available to ensure we only show versions
  // that have native binaries (not all JS package versions have native builds)
  const packageUrl = MACRO.NATIVE_PACKAGE_URL ?? MACRO.PACKAGE_URL;

  // Run from home directory to avoid reading project-level .npmrc
  const result = await execFileNoThrowWithCwd(
    "npm",
    ["view", packageUrl, "versions", "--json", "--prefer-online"],
    // Longer timeout for version list
    { abortSignal: AbortSignal.timeout(30000), cwd: homedir() }
  );

  if (result.code !== 0) {
    logForDebugging(`npm view versions failed with code ${result.code}`);
    if (result.stderr) {
      logForDebugging(`npm stderr: ${result.stderr.trim()}`);
    }
    return [];
  }

  try {
    const versions = jsonParse(result.stdout.trim()) as string[];
    // Take last N versions, then reverse to get newest first
    return versions.slice(-limit).reverse();
  } catch (error) {
    logForDebugging(`Failed to parse version history: ${error}`);
    return [];
  }
}

export async function installGlobalPackage(
  specificVersion?: string | null
): Promise<InstallStatus> {
  if (!(await acquireLock())) {
    logError(
      new AutoUpdaterError("Another process is currently installing an update")
    );
    // Log the lock contention
    logEvent("tengu_auto_updater_lock_contention", {
      pid: process.pid,
      currentVersion:
        MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    return "in_progress";
  }

  try {
    await removeMaximoAliasesFromShellConfigs();
    // Check if we're using npm from Windows path in WSL
    if (!env.isRunningWithBun() && env.isNpmFromWindowsPath()) {
      logError(new Error("Windows NPM detected in WSL environment"));
      logEvent("tengu_auto_updater_windows_npm_in_wsl", {
        currentVersion:
          MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.error(`
Error: Windows NPM detected in WSL

You're running Maximo Syntax in WSL but using the Windows NPM installation from /mnt/c/.
This configuration is not supported for updates.

To fix this issue:
  1. Install Node.js within your Linux distribution: e.g. sudo apt install nodejs npm
  2. Make sure Linux NPM is in your PATH before the Windows version
  3. Try updating again with 'maximo update'
`);
      return "install_failed";
    }

    const { hasPermissions } = await checkGlobalInstallPermissions();
    if (!hasPermissions) {
      return "no_permissions";
    }

    // Use specific version if provided, otherwise use latest
    const packageSpec = specificVersion
      ? `${MACRO.PACKAGE_URL}@${specificVersion}`
      : MACRO.PACKAGE_URL;

    // Run from home directory to avoid reading project-level .npmrc/.bunfig.toml
    // which could be maliciously crafted to redirect to an attacker's registry
    const packageManager = env.isRunningWithBun() ? "bun" : "npm";
    const installResult = await execFileNoThrowWithCwd(
      packageManager,
      ["install", "-g", packageSpec],
      { cwd: homedir() }
    );
    if (installResult.code !== 0) {
      const error = new AutoUpdaterError(
        `Failed to install new version of claude: ${installResult.stdout} ${installResult.stderr}`
      );
      logError(error);
      return "install_failed";
    }

    // Set installMethod to 'global' to track npm global installations
    saveGlobalConfig((current) => ({
      ...current,
      installMethod: "global",
    }));

    return "success";
  } finally {
    // Ensure we always release the lock
    await releaseLock();
  }
}

/**
 * Remove maximo aliases from shell configuration files
 * This helps clean up old installation methods when switching to native or npm global
 */
async function removeMaximoAliasesFromShellConfigs(): Promise<void> {
  const configMap = getShellConfigPaths();

  // Process each shell config file
  for (const [, configFile] of Object.entries(configMap)) {
    try {
      const lines = await readFileLines(configFile);
      if (!lines) continue;

      const { filtered, hadAlias } = filterMaximoAliases(lines);

      if (hadAlias) {
        await writeFileLines(configFile, filtered);
        logForDebugging(`Removed maximo alias from ${configFile}`);
      }
    } catch (error) {
      // Don't fail the whole operation if one file can't be processed
      logForDebugging(`Failed to remove alias from ${configFile}: ${error}`, {
        level: "error",
      });
    }
  }
}

// Minimum time between eager startup update attempts. The React AutoUpdater
// (mounted in the REPL footer) runs its own check on mount and every 30 min;
// without a cooldown the startup check + mount check would double-install.
const EAGER_UPDATE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// In-memory guard so concurrent callers in one process (startup + REPL mount)
// don't both run installs before either sets the cooldown timestamp.
let eagerUpdateInFlight = false;

/**
 * Check for an update and install it if available. Non-React engine shared by
 * the eager startup check and (optionally) other non-UI callers.
 *
 * Mirrors the guard chain in the React AutoUpdater but uses the real package
 * version (getCurrentRealVersion) for comparisons and is safe to call from
 * anywhere (no React state). Fires once per process at most (eagerUpdateInFlight)
 * and is throttled to once per hour via the persisted lastEagerUpdateCheck
 * timestamp in global config, so it composes with the 30-minute REPL interval
 * without double-installing.
 *
 * Returns the AutoUpdaterResult (or null when throttled/skipped) for callers
 * that want to surface it (e.g. the REPL footer).
 */
export async function checkAndInstallUpdate(
  opts: {
    force?: boolean;
  } = {},
): Promise<AutoUpdaterResult | null> {
  if (eagerUpdateInFlight) {
    return null;
  }

  // Skip in test/dev environments (same gate as the React updater).
  if (
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development"
  ) {
    logForDebugging(
      "AutoUpdater: Skipping update check in test/dev environment",
    );
    return null;
  }
  // Read the rollout/force config up front (non-blocking cached read). A
  // security force bypasses the user's auto-update opt-out, so the
  // isAutoUpdaterDisabled() gate below is conditional on no force applying.
  const rolloutConfig = await getRolloutConfig();
  const currentVersion = getCurrentRealVersion();
  const forcedSecurityVersion = getForcedSecurityVersion(
    rolloutConfig,
    currentVersion,
  );

  if (!forcedSecurityVersion && isAutoUpdaterDisabled()) {
    return null;
  }

  // Throttle: at most one eager check per hour unless forced (--force) or a
  // security force applies (critical patches must not be cooldown-throttled).
  if (!opts.force && !forcedSecurityVersion) {
    const config = getGlobalConfig();
    const lastCheck = config.lastEagerUpdateCheck ?? 0;
    if (Date.now() - lastCheck < EAGER_UPDATE_COOLDOWN_MS) {
      logForDebugging(
        `AutoUpdater: Skipping eager check, last check ${Date.now() - lastCheck}ms ago`,
      );
      return null;
    }
  }

  eagerUpdateInFlight = true;
  try {
    const channel = getInitialSettings()?.autoUpdatesChannel ?? "latest";
    let latestVersion = await getLatestVersion(channel);

    // Security force: a past-cutoff critical patch wins over the user's
    // opt-out and the rollout gate. Still respect the maxVersion kill switch
    // below (force never beats an incident pause).
    if (forcedSecurityVersion && forcedSecurityVersion !== currentVersion) {
      latestVersion = forcedSecurityVersion;
      logForDebugging(
        `AutoUpdater: security force applies — targeting ${forcedSecurityVersion} (current ${currentVersion})`,
      );
    }

    // Server-side kill switch: cap to maxVersion if set.
    const maxVersion = await getMaxVersion();
    if (maxVersion && latestVersion && gt(latestVersion, maxVersion)) {
      logForDebugging(
        `AutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latestVersion} to ${maxVersion}`,
      );
      if (gte(currentVersion, maxVersion)) {
        logForDebugging(
          `AutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`,
        );
        // No install — report running version (see note at the up-to-date path).
        return { version: currentVersion, status: "success" };
      }
      latestVersion = maxVersion;
    }

    // Record the check timestamp (even when there's nothing to install) so the
    // hourly throttle prevents repeated npm lookups.
    saveGlobalConfig((current) => ({
      ...current,
      lastEagerUpdateCheck: Date.now(),
    }));

    if (
      !currentVersion ||
      !latestVersion ||
      gte(currentVersion, latestVersion) ||
      // A security force must not be blocked by the user's minimumVersion
      // preference — critical patches win. The rollout gate also doesn't apply.
      (!forcedSecurityVersion && shouldSkipVersion(latestVersion))
    ) {
      // No install happened. Report the running version so callers can tell
      // "already up to date / deferred" (version === running) apart from a real
      // upgrade (version !== running).
      return { version: currentVersion, status: "success" };
    }

    // Staged rollout gate (Step 5): if the server is rolling this release out
    // to a percentage of users, only install for the deterministic cohort.
    // Security forces bypass the gate; the opt-out bypass already happened at
    // the top of the engine.
    const rolloutPercent = rolloutConfig.rolloutPercent;
    if (
      !forcedSecurityVersion &&
      typeof rolloutPercent === "number" &&
      rolloutPercent > 0 &&
      rolloutPercent < 100 &&
      !isInRolloutCohort(rolloutPercent, latestVersion)
    ) {
      logForDebugging(
        `AutoUpdater: update ${latestVersion} is in staged rollout (${rolloutPercent}%), user not in cohort — skipping`,
      );
      return { version: currentVersion, status: "success" };
    }

    const startTime = Date.now();
    const config = getGlobalConfig();

    // Remove native installer symlink since we're using JS-based updates,
    // unless the user migrated to a native installation.
    if (config.installMethod !== "native") {
      // Lazy import to avoid a module cycle: nativeInstaller/installer.ts
      // statically imports this file.
      const { removeInstalledSymlink } = await import(
        "./nativeInstaller/index.js"
      );
      await removeInstalledSymlink();
    }

    // Lazy import to avoid a module cycle: doctorDiagnostic.ts statically
    // imports this file, so importing it back at module scope would cycle.
    const { getCurrentInstallationType } = await import(
      "./doctorDiagnostic.js"
    );
    const installationType = await getCurrentInstallationType();
    logForDebugging(
      `AutoUpdater: Detected installation type: ${installationType}`,
    );

    // Skip update for development builds.
    if (installationType === "development") {
      logForDebugging("AutoUpdater: Cannot auto-update development build");
      return { version: latestVersion, status: "install_failed" };
    }

    let installStatus: InstallStatus;
    let updateMethod: "local" | "global";
    if (installationType === "npm-local") {
      logForDebugging("AutoUpdater: Using local update method");
      updateMethod = "local";
      // Lazy import to avoid a module cycle (localInstaller imports config,
      // not this file, but keeping the pattern consistent is cheap).
      const { installOrUpdateMaximoPackage } = await import(
        "./localInstaller.js"
      );
      installStatus = await installOrUpdateMaximoPackage(channel);
    } else if (installationType === "npm-global") {
      logForDebugging("AutoUpdater: Using global update method");
      updateMethod = "global";
      installStatus = await installGlobalPackage();
    } else if (installationType === "native") {
      // Native installations self-update via NativeAutoUpdater; the JS-side
      // updater shouldn't handle them (and cannot — the binary is managed by
      // the native installer). Report the running version (no JS install).
      logForDebugging(
        "AutoUpdater: Native installation, deferring to native updater",
      );
      return { version: currentVersion, status: "success" };
    } else {
      // Fallback to config-based detection for unknown types.
      logForDebugging(
        `AutoUpdater: Unknown installation type, falling back to config`,
      );
      const isMigrated = config.installMethod === "local";
      updateMethod = isMigrated ? "local" : "global";
      const { installOrUpdateMaximoPackage } = await import(
        "./localInstaller.js"
      );
      installStatus = isMigrated
        ? await installOrUpdateMaximoPackage(channel)
        : await installGlobalPackage();
    }

    if (installStatus === "success") {
      logEvent("tengu_auto_updater_success", {
        fromVersion:
          currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toVersion:
          latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs: Date.now() - startTime,
        wasMigrated: updateMethod === "local",
        installationType:
          installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    } else {
      logEvent("tengu_auto_updater_fail", {
        fromVersion:
          currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        attemptedVersion:
          latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        status:
          installStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs: Date.now() - startTime,
        wasMigrated: updateMethod === "local",
        installationType:
          installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }

    return { version: latestVersion, status: installStatus };
  } catch (error) {
    // Never reject from this fire-and-forget engine: a throw here (network
    // blip during `npm view`, a lazy import failing, a spawn error) would
    // surface as an unhandled rejection in the eager-startup or scheduler
    // paths. Log and degrade to a failed result instead.
    logError(error as Error);
    logForDiagnosticsNoPII("error", "auto_update_check_failed", {
      error_message: (error as Error).message?.slice(0, 2000) ?? String(error),
    });
    return { version: null, status: "install_failed" };
  } finally {
    eagerUpdateInFlight = false;
  }
}
