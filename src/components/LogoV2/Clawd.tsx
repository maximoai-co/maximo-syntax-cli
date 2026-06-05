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

type SegmentColor = "clawd_body" | "inactive" | "text" | "clawd_background";

type Segment = {
  text: string;
  color: SegmentColor;
  backgroundColor?: SegmentColor;
  bold?: boolean;
};

type OctopusFrame = readonly (readonly Segment[])[];

const body = (text: string): Segment => ({
  text,
  color: "clawd_body",
  bold: true,
});
const eye = (text: string): Segment => ({
  text,
  color: "text",
  backgroundColor: "clawd_body",
  bold: true,
});
const fill = (text: string): Segment => ({
  text,
  color: "clawd_background",
  backgroundColor: "clawd_body",
  bold: true,
});
const dim = (text: string): Segment => ({ text, color: "inactive" });

export const OCTOPUS_COMPACT_WIDTH = 24;
export const OCTOPUS_COMPACT_HEIGHT = 7;
export const OCTOPUS_DETAILED_WIDTH = 26;
export const OCTOPUS_DETAILED_HEIGHT = 8;

const POSES: Record<OctopusPose, OctopusFrame> = {
  default: [
    [body("     ▄██████▄     ")],
    [body("   ▄██"), fill("      "), body("██▄   ")],
    [body("  ███"), fill(" "), eye("●"), fill("  "), eye("●"), fill(" "), body("███  ")],
    [body("  ███"), fill("   "), eye("▾"), fill("   "), body("███  ")],
    [body("   ▀████████▀   ")],
    [body(" ▄█▀ ▐█▌▐█▌ ▀█▄ ")],
    [dim("▀▀  "), body("╰╯╰╯╰╯╰╯"), dim("  ▀▀")],
  ],
  "look-left": [
    [body("     ▄██████▄     ")],
    [body("   ▄██"), fill("      "), body("██▄   ")],
    [body("  ███"), eye("●"), fill("   "), eye("●"), fill(" "), body("███  ")],
    [body("  ███"), fill("  "), eye("◂"), fill("    "), body("███  ")],
    [body("   ▀████████▀   ")],
    [body(" ▄█▀ ▐█▌▐█▌ ▀█▄ ")],
    [dim("▀▀  "), body("╰╯╰╯╰╯╰╯"), dim("  ▀▀")],
  ],
  "look-right": [
    [body("     ▄██████▄     ")],
    [body("   ▄██"), fill("      "), body("██▄   ")],
    [body("  ███"), fill(" "), eye("●"), fill("   "), eye("●"), body("███  ")],
    [body("  ███"), fill("    "), eye("▸"), fill("  "), body("███  ")],
    [body("   ▀████████▀   ")],
    [body(" ▄█▀ ▐█▌▐█▌ ▀█▄ ")],
    [dim("▀▀  "), body("╰╯╰╯╰╯╰╯"), dim("  ▀▀")],
  ],
  "arms-up": [
    [body(" ▄▄  ▄██████▄  ▄▄ ")],
    [body(" ██▄██"), fill("      "), body("██▄██ ")],
    [body("  ███"), fill(" "), eye("●"), fill("  "), eye("●"), fill(" "), body("███  ")],
    [body("  ███"), fill("   "), eye("▾"), fill("   "), body("███  ")],
    [body("   ▀████████▀   ")],
    [body(" ▄█▀ ▐█▌▐█▌ ▀█▄ ")],
    [dim("▀▀  "), body("╰╯╰╯╰╯╰╯"), dim("  ▀▀")],
  ],
};

const DETAILED_FRAME: OctopusFrame = [
  [body("      ▄████████▄      ")],
  [body("    ▄██"), fill("        "), body("██▄    ")],
  [body("   ███"), fill(" "), eye("●"), fill("    "), eye("●"), fill(" "), body("███   ")],
  [body("   ███"), fill("    "), eye("▾"), fill("    "), body("███   ")],
  [body("    ▀██████████▀    ")],
  [body("  ▄█▀ ▐█▌▐█▌▐█▌ ▀█▄  ")],
  [body("▄█▀   ▐█▌  ▐█▌   ▀█▄")],
  [dim("▀   "), body("╰╯╰╯╰╯╰╯"), dim("   ▀")],
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
              backgroundColor={segment.backgroundColor}
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
