import React from "react";
import { Box, Text } from "src/ink.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { Clawd, OCTOPUS_COMPACT_WIDTH } from "./Clawd.js";

function SetupRow({ children }: { children: React.ReactNode }) {
  return (
    <Text>
      <Text color="maximo">• </Text>
      <Text dimColor>{children}</Text>
    </Text>
  );
}

export function WelcomeV2() {
  const { columns } = useTerminalSize();
  const version = MACRO.DISPLAY_VERSION ?? MACRO.VERSION;
  const width = Math.max(48, Math.min(columns || 92, 92));
  const stacked = width < OCTOPUS_COMPACT_WIDTH + 42;

  return (
    <Box
      borderStyle="round"
      borderColor="maximo"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      width={width}
    >
      <Box
        flexDirection={stacked ? "column" : "row"}
        gap={stacked ? 1 : 2}
        alignItems={stacked ? "center" : "center"}
      >
        <Box flexShrink={0}>
          <Clawd />
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          <Text>
            <Text bold color="maximo">MAXIMO SYNTAX</Text>
            <Text dimColor> v{version}</Text>
          </Text>
          <Text bold color="maximo">Move at Maximo Speed</Text>
          <Text dimColor>Build, ship, and iterate from your terminal.</Text>
          <Text dimColor>AI-powered CLI for developer workflows.</Text>
          <Box marginTop={1} flexDirection="column">
            <SetupRow>Advanced Maximo AI integration</SetupRow>
            <SetupRow>Review edits and commands before they run</SetupRow>
            <SetupRow>Resume recent sessions with /resume</SetupRow>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
