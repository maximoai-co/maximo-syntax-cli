import * as React from "react";
import { Box, Text } from "../../ink.js";

export type OctopusPose =
  | "default"
  | "arms-up"
  | "look-left"
  | "look-right";

// Keep the existing public type name so imports across the CLI remain stable.
export type ClawdPose = OctopusPose;

type Props = {
  pose?: OctopusPose;
  variant?: "compact" | "detailed";
};

type SegmentColor = "success" | "claudeShimmer" | "clawd_body";

type Segment = {
  text: string;
  color: SegmentColor;
  bold?: boolean;
};

type OctopusFrame = readonly (readonly Segment[])[];

const top = (text: string): Segment => ({
  text,
  color: "success",
  bold: true,
});
const middle = (text: string): Segment => ({
  text,
  color: "claudeShimmer",
  bold: true,
});
const bottom = (text: string): Segment => ({
  text,
  color: "clawd_body",
  bold: true,
});

export const OCTOPUS_COMPACT_WIDTH = 24;
export const OCTOPUS_COMPACT_HEIGHT = 7;
export const OCTOPUS_DETAILED_WIDTH = 26;
export const OCTOPUS_DETAILED_HEIGHT = 8;

const COMPACT_FRAME: OctopusFrame = [
  [top("    ╭────╮    ╭────╮    ")],
  [top("   ╭╯    ╰╮  ╭╯    ╰╮   ")],
  [middle("   │      ╰──╯      │   ")],
  [middle("   │  ╭╮        ╭╮  │   ")],
  [bottom("   │  │╰╮      ╭╯│  │   ")],
  [bottom("   │  │ ╰╮    ╭╯ │  │   ")],
  [bottom("   ╰──╯  ╰────╯  ╰──╯   ")],
];

// Keep the legacy poses mapped to the same brand mark so the existing
// animation and public component API remain stable.
const POSES: Record<OctopusPose, OctopusFrame> = {
  default: COMPACT_FRAME,
  "look-left": COMPACT_FRAME,
  "look-right": COMPACT_FRAME,
  "arms-up": COMPACT_FRAME,
};

const DETAILED_FRAME: OctopusFrame = [
  [top("    ╭─────╮    ╭─────╮    ")],
  [top("   ╭╯     ╰╮  ╭╯     ╰╮   ")],
  [middle("  ╭╯       ╰──╯       ╰╮  ")],
  [middle("  │   ╭╮          ╭╮   │  ")],
  [bottom("  │   │╰╮        ╭╯│   │  ")],
  [bottom("  │   │ ╰╮      ╭╯ │   │  ")],
  [bottom("  │   │  ╰╮    ╭╯  │   │  ")],
  [bottom("  ╰───╯   ╰────╯   ╰───╯  ")],
];

export function OctopusMascot({
  pose = "default",
  variant = "compact",
}: Props = {}): React.ReactNode {
  const frame = variant === "detailed" ? DETAILED_FRAME : POSES[pose];

  return (
    <Box flexDirection="column" alignItems="center">
      {frame.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {row.map((segment, segmentIndex) => (
            <Text
              key={segmentIndex}
              bold={segment.bold}
              color={segment.color}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

// Back-compatible export name used by the existing logo stack.
export function Clawd(props: Props = {}): React.ReactNode {
  return <OctopusMascot {...props} />;
}
