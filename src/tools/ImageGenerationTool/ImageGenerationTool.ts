import type { PermissionResult } from "src/utils/permissions/PermissionResult.js";
import { z } from "zod/v4";
import {
  getMaximoAIBaseUrl,
  getMaximoApiKey,
} from "../../services/api/maximoModels.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { logError } from "../../utils/log.js";
import {
  getImageGenerationPrompt,
  IMAGE_GENERATION_TOOL_NAME,
} from "./prompt.js";

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z.string().min(1).describe("The image generation prompt to use"),
    // Optional generation controls forwarded to the backend image tool.
    aspect_ratio: z
      .string()
      .optional()
      .describe('Aspect ratio for the image (e.g. "16:9", "1:1", "4:3")'),
    size: z
      .string()
      .optional()
      .describe('Image size/resolution (e.g. "1K", "2K", "4K")'),
    output_count: z
      .number()
      .int()
      .positive()
      .max(4)
      .optional()
      .describe("Number of images to generate (1-4)"),
  })
);
type InputSchema = ReturnType<typeof inputSchema>;

type Input = z.infer<InputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    prompt: z.string().describe("The image prompt that was executed"),
    images: z
      .array(
        z.object({
          url: z.string().describe("The URL of the generated image"),
        })
      )
      .describe("The generated image URLs"),
    credits: z.unknown().optional().describe("Credit/usage info from the backend"),
    modelUsed: z.string().nullable().optional(),
    durationSeconds: z
      .number()
      .describe("Time taken to complete the image generation operation"),
  })
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

/**
 * Resolve the image-generation endpoint for the configured Maximo AI API base URL.
 * - api.maximoai.co      -> /v1/api/image-generation
 * - api.mytabulon.com    -> /v1/image-generation
 * Returns null when the base URL is a backend we don't provide image generation for.
 */
function resolveImageEndpoint(baseUrl: string): {
  url: string;
  path: string;
} | null {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.includes("api.mytabulon.com")) {
    return { url: `${trimmed}/image-generation`, path: "/v1/image-generation" };
  }
  // Default to the Maximo AI API (api.maximoai.co and any other host).
  // The backend serves image generation at /v1/api/image-generation (mounted at
  // /v1/api in run.js) to bypass the globally-locked /api prefix. The trailing
  // /v1 on the base URL is stripped, then /v1/api/image-generation is appended.
  return {
    url: `${trimmed.replace(/\/v1$/, "")}/v1/api/image-generation`,
    path: "/v1/api/image-generation",
  };
}

export const ImageGenerationTool = buildTool({
  name: IMAGE_GENERATION_TOOL_NAME,
  searchHint: "generate images with the connected Maximo backend",
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Maximo wants to generate an image for: ${input.prompt}`;
  },
  userFacingName() {
    return "Image Generation";
  },
  isEnabled() {
    const baseUrl = getMaximoAIBaseUrl();
    const apiKey = getMaximoApiKey();
    // Only enable when a Maximo-issued credential exists for a backend we
    // provide image generation on. Pure Cencori/openai-provider logins carry a
    // key that api.maximoai.co cannot validate, so the tool stays disabled there
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
    return false;
  },
  toAutoClassifierInput(input) {
    return input.prompt;
  },
  async checkPermissions(_input): Promise<PermissionResult> {
    return {
      behavior: "passthrough",
      message: "ImageGenerationTool requires permission.",
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: IMAGE_GENERATION_TOOL_NAME }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
    };
  },
  async prompt() {
    return getImageGenerationPrompt();
  },
  renderToolUseMessage({ prompt }, { verbose }) {
    if (!prompt) {
      return null;
    }
    return `${verbose ? "Generating image for: " : ""}"${prompt}"`;
  },
  renderToolUseProgressMessage() {
    return null;
  },
  renderToolResultMessage(output) {
    return null;
  },
  extractSearchText() {
    return "";
  },
  async validateInput(input) {
    const { prompt } = input;
    if (!prompt || prompt.trim().length === 0) {
      return {
        result: false,
        message: "Error: Missing prompt",
        errorCode: 1,
      };
    }
    return { result: true };
  },
  async call(input, context, _canUseTool, _parentMessage, onProgress) {
    const startTime = performance.now();
    const { prompt, ...rest } = input;

    const baseUrl = getMaximoAIBaseUrl();
    const apiKey = getMaximoApiKey();
    const endpoint = resolveImageEndpoint(baseUrl);

    if (!apiKey || !endpoint) {
      return {
        data: {
          prompt,
          images: [],
          durationSeconds: (performance.now() - startTime) / 1000,
        },
      };
    }

    if (onProgress) {
      onProgress({
        toolUseID: "image-progress-1",
        data: { type: "image_generation_started", prompt },
      });
    }

    const requestBody: Record<string, unknown> = { prompt, ...rest };

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
          new Error(
            `Image generation request failed (${response.status}): ${rawText}`
          )
        );
        return {
          data: {
            prompt,
            images: [],
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
            prompt,
            images: [],
            durationSeconds: (performance.now() - startTime) / 1000,
          },
        };
      }

      const images: { url: string }[] = Array.isArray(parsed?.images)
        ? parsed.images
            .map((image: unknown) =>
              image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string"
                ? { url: (image as { url: string }).url }
                : null
            )
            .filter((image: { url: string } | null): image is { url: string } => Boolean(image))
        : [];

      if (onProgress) {
        onProgress({
          toolUseID: "image-progress-2",
          data: {
            type: "image_generation_completed",
            imageCount: images.length,
            prompt,
          },
        });
      }

      return {
        data: {
          prompt,
          images,
          credits: parsed?.credits ?? null,
          modelUsed: parsed?.modelUsed ?? null,
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
          prompt,
          images: [],
          durationSeconds: (performance.now() - startTime) / 1000,
        },
      };
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { prompt, images } = output;

    const lines: string[] = [];
    lines.push(`Generated image${images.length === 1 ? "" : "s"} for prompt: "${prompt}"`);
    if (!images || images.length === 0) {
      lines.push("No images were returned — generation failed. Do NOT invent a URL (never use https://example.com, https://via.placeholder.com, https://placehold.co, https://picsum.photos, or https://ai-image-output...). Tell the user it failed, why it might have (check login: Maximo AI / MyTabulon required), and ask to try again.");
      lines.push("FORBIDDEN PLACEHOLDERS: https://example.com, https://via.placeholder.com, https://placehold.co, https://picsum.photos — using any of these is a failure.");
    } else {
      for (let i = 0; i < images.length; i++) {
        const url = images[i]?.url;
        if (url) {
          lines.push(`Image ${i + 1} URL: ${url}`);
        }
      }
      lines.push(
        "IMPORTANT: Use the exact URL(s) above verbatim in your markdown. Do NOT invent, shorten, or change the domain/path. Example: ![alt text](<exact URL>)"
      );
    }

    const blocks: Array<Record<string, unknown>> = [
      { type: "text", text: lines.join("\n") },
    ];

    // Surface the generated images to the model as image blocks so it can
    // describe/embed them in its response.
    for (const image of images ?? []) {
      if (image?.url) {
        blocks.push({
          type: "image",
          source: { type: "url", url: image.url },
        });
      }
    }

    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: blocks as any,
    };
  },
} satisfies ToolDef<InputSchema, Output>);
