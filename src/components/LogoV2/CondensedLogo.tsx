import * as React from "react";
import { type ReactNode, useEffect } from "react";
import { useMainLoopModel } from "../../hooks/useMainLoopModel.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { stringWidth } from "../../ink/stringWidth.js";
import { Box, Text } from "../../ink.js";
import { useAppState } from "../../state/AppState.js";
import { getEffortSuffix } from "../../utils/effort.js";
import { truncate } from "../../utils/format.js";
import { isFullscreenEnvEnabled } from "../../utils/fullscreen.js";
import {
  formatModelAndBilling,
  getLogoDisplayData,
  truncatePath,
} from "../../utils/logoV2Utils.js";
import { renderModelSetting } from "../../utils/model/model.js";
import { OffscreenFreeze } from "../OffscreenFreeze.js";
import { AnimatedClawd } from "./AnimatedClawd.js";
import { Clawd, OCTOPUS_COMPACT_WIDTH } from "./Clawd.js";
import {
  GuestPassesUpsell,
  incrementGuestPassesSeenCount,
  useShowGuestPassesUpsell,
} from "./GuestPassesUpsell.js";
import {
  incrementOverageCreditUpsellSeenCount,
  OverageCreditUpsell,
  useShowOverageCreditUpsell,
} from "./OverageCreditUpsell.js";

export function CondensedLogo(): ReactNode {
  const { columns } = useTerminalSize();
  const agent = useAppState((s) => s.agent);
  const effortValue = useAppState((s) => s.effortValue);
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings,
  } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
  const showGuestPassesUpsell = useShowGuestPassesUpsell();
  const showOverageCreditUpsell = useShowOverageCreditUpsell();

  useEffect(() => {
    if (showGuestPassesUpsell) {
      incrementGuestPassesSeenCount();
    }
  }, [showGuestPassesUpsell]);

  useEffect(() => {
    if (showOverageCreditUpsell && !showGuestPassesUpsell) {
      incrementOverageCreditUpsellSeenCount();
    }
  }, [showOverageCreditUpsell, showGuestPassesUpsell]);

  const cardWidth = Math.max(46, Math.min(columns || 88, 88));
  const stacked = cardWidth < OCTOPUS_COMPACT_WIDTH + 34;
  const contentWidth = Math.max(20, cardWidth - 6);
  const mascot = isFullscreenEnvEnabled() ? <AnimatedClawd /> : <Clawd />;
  const textWidth = stacked
    ? contentWidth
    : Math.max(24, contentWidth - OCTOPUS_COMPACT_WIDTH - 2);
  const truncatedVersion = truncate(version, Math.max(textWidth - 3, 6));
  const effortSuffix = getEffortSuffix(model, effortValue);
  const { shouldSplit, truncatedModel, truncatedBilling } =
    formatModelAndBilling(
      modelDisplayName + effortSuffix,
      billingType,
      textWidth
    );
  const cwdAvailableWidth = agentName
    ? textWidth - 1 - stringWidth(agentName) - 3
    : textWidth;
  const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 10));
  const location = agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd;

  const details = (
    <Box flexDirection="column" flexShrink={1}>
      <Text>
        <Text bold color="claude">MAXIMO SYNTAX</Text>
        <Text dimColor> v{truncatedVersion}</Text>
      </Text>
      <Text color="claude">Move at Maximo Speed</Text>
      <Text dimColor>Build, ship, and iterate from your terminal</Text>
      <Box marginTop={1} flexDirection="column">
        {shouldSplit ? (
          <>
            <Text>
              <Text color="inactive">Model</Text>
              <Text dimColor> {truncatedModel}</Text>
            </Text>
            <Text>
              <Text color="inactive">Mode</Text>
              <Text dimColor> {truncatedBilling}</Text>
            </Text>
          </>
        ) : (
          <Text>
            <Text color="inactive">Model</Text>
            <Text dimColor>
              {" "}
              {truncatedModel} · {truncatedBilling}
            </Text>
          </Text>
        )}
        <Text>
          <Text color="inactive">Workspace</Text>
          <Text dimColor> {location}</Text>
        </Text>
      </Box>
      {showGuestPassesUpsell && <GuestPassesUpsell />}
      {!showGuestPassesUpsell && showOverageCreditUpsell && (
        <OverageCreditUpsell maxWidth={textWidth} twoLine />
      )}
    </Box>
  );

  return (
    <OffscreenFreeze>
      <Box
        borderStyle="round"
        borderColor="claude"
        paddingX={2}
        paddingY={1}
        width={cardWidth}
        flexDirection={stacked ? "column" : "row"}
        gap={stacked ? 1 : 2}
        alignItems={stacked ? "center" : "center"}
      >
        <Box flexDirection="column" alignItems="center" flexShrink={0}>
          {mascot}
        </Box>
        {details}
      </Box>
    </OffscreenFreeze>
  );
}
