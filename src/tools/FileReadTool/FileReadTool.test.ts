import { expect, test } from "bun:test";
import { getEmptyToolPermissionContext } from "../../Tool.js";
import { FileReadTool } from "./FileReadTool.js";

test("treats an empty pages value as an omitted page filter", async () => {
  const result = await FileReadTool.validateInput(
    { file_path: "/tmp/screenshot.png", pages: "" },
    {
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
    } as never,
  );

  expect(result.result).toBe(true);
});
