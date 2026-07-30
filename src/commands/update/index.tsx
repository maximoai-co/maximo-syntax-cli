import React, { useEffect, useState } from "react";
import type { Command, LocalJSXCommandContext } from "../../commands.js";
import type { LocalJSXCommandOnDone } from "../../types/command.js";
import { Box, Text } from "../../ink.js";
import { StatusIcon } from "../../components/design-system/StatusIcon.js";
import { logEvent } from "../../services/analytics/index.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { getLatestVersion, installGlobalPackage } from "../../utils/autoUpdater.js";
import { getCurrentInstallationType } from "../../utils/doctorDiagnostic.js";

type UpdateState =
  | { type: "checking" }
  | { type: "updating" }
  | { type: "externally-managed"; detail: string }
  | { type: "success"; version: string }
  | { type: "already-latest"; version: string }
  | { type: "no-permissions" }
  | { type: "in_progress" }
  | { type: "error"; message: string };

function UpdateUI({ onDone }: { onDone: LocalJSXCommandOnDone }) {
  const [state, setState] = useState<UpdateState>({ type: "checking" });

  useEffect(() => {
    (async () => {
      try {
        const installationType = await getCurrentInstallationType();

        // Don't clobber installations managed by the native updater or an OS
        // package manager — those update themselves through their own channel.
        if (installationType === "native") {
          setState({
            type: "externally-managed",
            detail:
              "This CLI is managed by the native updater and updates itself automatically.",
          });
          return;
        }
        if (installationType === "package-manager") {
          setState({
            type: "externally-managed",
            detail:
              "This CLI is managed by your OS package manager. Update it with your package manager (e.g. brew upgrade @maximoai/maximo-syntax-cli).",
          });
          return;
        }
        if (installationType === "development") {
          setState({
            type: "externally-managed",
            detail: "You're running a development build — nothing to update here.",
          });
          return;
        }

        const latest = await getLatestVersion("latest");
        if (latest && latest === MACRO.VERSION) {
          setState({ type: "already-latest", version: latest });
          return;
        }

        setState({ type: "updating" });
        logEvent("tengu_update_command_started", {});
        // Runs `npm install -g @maximoai/maximo-syntax-cli` (latest dist-tag) from
        // the user's home dir, so it always pulls the newest published version.
        const result = await installGlobalPackage();

        if (result === "success") {
          setState({ type: "success", version: latest ?? MACRO.VERSION });
        } else if (result === "no_permissions") {
          setState({ type: "no-permissions" });
        } else if (result === "in_progress") {
          setState({ type: "in_progress" });
        } else {
          setState({
            type: "error",
            message:
              "Update failed. You can update manually with:\n  npm install -g @maximoai/maximo-syntax-cli",
          });
        }
      } catch (e) {
        setState({
          type: "error",
          message: (e as Error).message,
        });
      }
    })();
    // run once on mount
  }, []);

  useEffect(() => {
    const finish = (msg: string) => onDone(msg, { display: "system" as const });

    if (state.type === "already-latest") {
      const t = setTimeout(
        () => finish(`Already up to date (${state.version}).`),
        1500,
      );
      return () => clearTimeout(t);
    }
    if (state.type === "success") {
      const t = setTimeout(
        () =>
          finish(
            "Maximo Syntax updated. Restart the CLI to use the new version.",
          ),
        2500,
      );
      return () => clearTimeout(t);
    }
    if (state.type === "externally-managed") {
      const t = setTimeout(() => finish(state.detail), 2500);
      return () => clearTimeout(t);
    }
    if (state.type === "no-permissions") {
      const t = setTimeout(
        () =>
          finish(
            "Update needs write access to the global npm prefix. Run with the right permissions, or update manually with npm install -g @maximoai/maximo-syntax-cli.",
          ),
        3000,
      );
      return () => clearTimeout(t);
    }
    if (state.type === "in_progress") {
      const t = setTimeout(
        () => finish("Another update is already running. Try again in a moment."),
        2000,
      );
      return () => clearTimeout(t);
    }
    if (state.type === "error") {
      const t = setTimeout(
        () => finish("Update failed — see the message above."),
        3000,
      );
      return () => clearTimeout(t);
    }
  }, [state, onDone]);

  return (
    <Box flexDirection="column" marginTop={1}>
      {state.type === "checking" && (
        <Text color="maximo">Checking for updates…</Text>
      )}
      {state.type === "updating" && (
        <Text color="maximo">
          {"Updating Maximo Syntax via npm (npm install -g @maximoai/maximo-syntax-cli)…"}
        </Text>
      )}
      {state.type === "already-latest" && (
        <Box>
          <StatusIcon status="success" withSpace />
          <Text color="success" bold>
            Already up to date ({state.version})
          </Text>
        </Box>
      )}
      {state.type === "success" && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="success" withSpace />
            <Text color="success" bold>
              Maximo Syntax updated!
            </Text>
          </Box>
          {state.version !== MACRO.VERSION && (
            <Box marginLeft={2}>
              <Text dimColor>New version: </Text>
              <Text color="maximo">{state.version}</Text>
            </Box>
          )}
          <Box marginLeft={2}>
            <Text dimColor>Restart the CLI to use the new version.</Text>
          </Box>
        </Box>
      )}
      {state.type === "externally-managed" && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="warning" withSpace />
            <Text color="warning">Nothing to do here</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>{state.detail}</Text>
          </Box>
        </Box>
      )}
      {state.type === "no-permissions" && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="error" withSpace />
            <Text color="error">
              Update needs write access to the global npm prefix
            </Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              Run with the right permissions, or run manually:
              npm install -g @maximoai/maximo-syntax-cli
            </Text>
          </Box>
        </Box>
      )}
      {state.type === "in_progress" && (
        <Box>
          <StatusIcon status="warning" withSpace />
          <Text color="warning">
            Another update is already running. Try again in a moment.
          </Text>
        </Box>
      )}
      {state.type === "error" && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="error" withSpace />
            <Text color="error">Update failed</Text>
          </Box>
          <Text color="error">{state.message}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <UpdateUI onDone={onDone} />;
}

export default (): Command => ({
  type: "local-jsx",
  name: "update",
  description: "Update Maximo Syntax to the latest version via npm",
  aliases: ["upgrade-cli"],
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_UPDATE_COMMAND),
  load: () => import("./index.js"),
});
