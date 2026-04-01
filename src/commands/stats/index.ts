import type { Command } from "../../commands.js";

const stats = {
  type: "local-jsx",
  name: "stats",
  description: "Show your Maximo Syntax usage statistics and activity",
  load: () => import("./stats.js"),
} satisfies Command;

export default stats;
