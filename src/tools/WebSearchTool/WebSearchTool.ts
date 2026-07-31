import type { PermissionResult } from "src/utils/permissions/PermissionResult.js";
import { z } from "zod/v4";
import { getFeatureValue_CACHED_MAY_BE_STALE } from "../../services/analytics/growthbook.js";
import {
  getMaximoAIBaseUrl,
  getMaximoApiKey,
} from "../../services/api/maximoModels.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { logError } from "../../utils/log.js";
import { getWebSearchPrompt, WEB_SEARCH_TOOL_NAME } from "./prompt.js";
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from "./UI.js";

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe("The search query to use"),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe("Only include search results from these domains"),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe("Never include search results from these domains"),
    // Free-form search controls forwarded to the Pandora/Exa backend. The
    // Syntax AI decides these (result count, type, content depth, etc.).
    numResults: z.number().int().positive().optional(),
    type: z
      .enum(["instant", "fast", "neural", "auto", "deep"])
      .optional(),
    includeText: z.array(z.string()).optional(),
    excludeText: z.array(z.string()).optional(),
    contents: z.record(z.string(), z.unknown()).optional(),
    extras: z.record(z.string(), z.unknown()).optional(),
  })
);
type InputSchema = ReturnType<typeof inputSchema>;

type Input = z.infer<InputSchema>;

const searchResultSchema = lazySchema(() => {
  const searchHitSchema = z.object({
    title: z.string().describe("The title of the search result"),
    url: z.string().describe("The URL of the search result"),
    author: z.string().nullable().optional(),
    publishedDate: z.string().nullable().optional(),
    text: z.string().optional(),
  });

  return z.object({
    tool_use_id: z.string().describe("ID of the tool use"),
    content: z.array(searchHitSchema).describe("Array of search hits"),
  });
});

export type SearchResult = z.infer<ReturnType<typeof searchResultSchema>>;

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string().describe("The search query that was executed"),
    results: z
      .array(z.union([searchResultSchema(), z.string()]))
      .describe("Search results and/or text commentary from the model"),
    durationSeconds: z
      .number()
      .describe("Time taken to complete the search operation"),
  })
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

// Re-export WebSearchProgress from centralized types to break import cycles
export type { WebSearchProgress } from "../../types/tools.js";

import type { WebSearchProgress } from "../../types/tools.js";

/**
 * Resolve the web-search endpoint for the configured Maximo AI API base URL.
 * - api.maximoai.co      -> /api/web-search
 * - api.mytabulon.com    -> /v1/web-search
 * Returns null when the base URL is a backend we don't provide web search for.
 */
function resolveWebSearchEndpoint(baseUrl: string): {
  url: string;
  path: string;
} | null {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.includes("api.mytabulon.com")) {
    return { url: `${trimmed}/web-search`, path: "/v1/web-search" };
  }
  // Default to the Maximo AI API (api.maximoai.co and any other host).
  return { url: `${trimmed.replace(/\/v1$/, "")}/web-search`, path: "/api/web-search" };
}

export const WebSearchTool = buildTool({
  name: WEB_SEARCH_TOOL_NAME,
  searchHint: "search the web for current information",
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Maximo wants to search the web for: ${input.query}`;
  },
  userFacingName() {
    return "Web Search";
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input);
    return summary ? `Searching for ${summary}` : "Searching the web";
  },
  isEnabled() {
    const baseUrl = getMaximoAIBaseUrl();
    const apiKey = getMaximoApiKey();
    // Only enable when a Maximo-issued credential exists for a backend we
    // provide web search on. Pure Cencori/openai-provider logins carry a key
    // that api.maximoai.co cannot validate, so the tool stays disabled there
    // (avoids broken 401s). MyTabulon and Maximo AI logins work.
    if (!apiKey) return false;
    if (baseUrl.includes("api.cencori.com")) return false;
    return true;
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.query;
  },
  async checkPermissions(_input): Promise<PermissionResult> {
    return {
      behavior: "passthrough",
      message: "WebSearchTool requires permission.",
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: WEB_SEARCH_TOOL_NAME }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
    };
  },
  async prompt() {
    return getWebSearchPrompt();
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  extractSearchText() {
    return "";
  },
  async validateInput(input) {
    const { query, allowed_domains, blocked_domains } = input;
    if (!query || query.trim().length === 0) {
      return {
        result: false,
        message: "Error: Missing query",
        errorCode: 1,
      };
    }
    if (allowed_domains?.length && blocked_domains?.length) {
      return {
        result: false,
        message:
          "Error: Cannot specify both allowed_domains and blocked_domains in the same request",
        errorCode: 2,
      };
    }
    return { result: true };
  },
  async call(input, context, _canUseTool, _parentMessage, onProgress) {
    const startTime = performance.now();
    const { query, allowed_domains, blocked_domains, ...searchParams } = input;

    const baseUrl = getMaximoAIBaseUrl();
    const apiKey = getMaximoApiKey();
    const endpoint = resolveWebSearchEndpoint(baseUrl);

    if (!apiKey || !endpoint) {
      return {
        data: {
          query,
          results: [
            "Web search is unavailable: no Maximo AI credential is configured for this session.",
          ],
          durationSeconds: (performance.now() - startTime) / 1000,
        },
      };
    }

    if (onProgress) {
      onProgress({
        toolUseID: "search-progress-1",
        data: { type: "query_update", query },
      });
    }

    const requestBody: Record<string, unknown> = { query, ...searchParams };
    if (allowed_domains?.length) requestBody.includeDomains = allowed_domains;
    if (blocked_domains?.length) requestBody.excludeDomains = blocked_domains;

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: context.abortController.signal,
      });

      const rawText = await response.text();

      if (!response.ok) {
        logError(
          new Error(`Web search request failed (${response.status}): ${rawText}`)
        );
        return {
          data: {
            query,
            results: [
              `Web search failed (${response.status}). Please try again later.`,
            ],
            durationSeconds: (performance.now() - startTime) / 1000,
          },
        };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return {
          data: {
            query,
            results: ["Web search returned an unparseable response."],
            durationSeconds: (performance.now() - startTime) / 1000,
          },
        };
      }

      const hits: { title: string; url: string }[] = Array.isArray(
        parsed?.results
      )
        ? parsed.results
        : [];

      if (onProgress) {
        onProgress({
          toolUseID: "search-progress-2",
          data: {
            type: "search_results_received",
            resultCount: hits.length,
            query,
          },
        });
      }

      const toolUseId = `web-search-${Date.now()}`;
      const results: (SearchResult | string)[] = [];

      if (hits.length > 0) {
        results.push({
          tool_use_id: toolUseId,
          content: hits.map((h) => ({ title: h.title, url: h.url })),
        });
      } else {
        results.push("No web search results were returned.");
      }

      return {
        data: {
          query,
          results,
          durationSeconds: (performance.now() - startTime) / 1000,
        },
      };
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw error;
      }
      logError(error as Error);
      return {
        data: {
          query,
          results: ["Web search encountered an error. Please try again."],
          durationSeconds: (performance.now() - startTime) / 1000,
        },
      };
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { query, results } = output;

    let formattedOutput = `Web search results for query: "${query}"\n\n`;

    (results ?? []).forEach((result) => {
      if (result == null) {
        return;
      }
      if (typeof result === "string") {
        formattedOutput += result + "\n\n";
      } else {
        if (result.content?.length > 0) {
          formattedOutput += `Links: ${JSON.stringify(result.content)}\n\n`;
        } else {
          formattedOutput += "No links found.\n\n";
        }
      }
    });

    formattedOutput +=
      "\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.";

    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: formattedOutput.trim(),
    };
  },
} satisfies ToolDef<InputSchema, Output, WebSearchProgress>);
