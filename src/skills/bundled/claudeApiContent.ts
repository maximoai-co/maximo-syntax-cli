// Content for the claude-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpMaximoApi from "./claude-api/csharp/claude-api.md";
import curlExamples from "./claude-api/curl/examples.md";
import goMaximoApi from "./claude-api/go/claude-api.md";
import javaMaximoApi from "./claude-api/java/claude-api.md";
import phpMaximoApi from "./claude-api/php/claude-api.md";
import pythonAgentSdkPatterns from "./claude-api/python/agent-sdk/patterns.md";
import pythonAgentSdkReadme from "./claude-api/python/agent-sdk/README.md";
import pythonMaximoApiBatches from "./claude-api/python/claude-api/batches.md";
import pythonMaximoApiFilesApi from "./claude-api/python/claude-api/files-api.md";
import pythonMaximoApiReadme from "./claude-api/python/claude-api/README.md";
import pythonMaximoApiStreaming from "./claude-api/python/claude-api/streaming.md";
import pythonMaximoApiToolUse from "./claude-api/python/claude-api/tool-use.md";
import rubyMaximoApi from "./claude-api/ruby/claude-api.md";
import skillPrompt from "./claude-api/SKILL.md";
import sharedErrorCodes from "./claude-api/shared/error-codes.md";
import sharedLiveSources from "./claude-api/shared/live-sources.md";
import sharedModels from "./claude-api/shared/models.md";
import sharedPromptCaching from "./claude-api/shared/prompt-caching.md";
import sharedToolUseConcepts from "./claude-api/shared/tool-use-concepts.md";
import typescriptAgentSdkPatterns from "./claude-api/typescript/agent-sdk/patterns.md";
import typescriptAgentSdkReadme from "./claude-api/typescript/agent-sdk/README.md";
import typescriptMaximoApiBatches from "./claude-api/typescript/claude-api/batches.md";
import typescriptMaximoApiFilesApi from "./claude-api/typescript/claude-api/files-api.md";
import typescriptMaximoApiReadme from "./claude-api/typescript/claude-api/README.md";
import typescriptMaximoApiStreaming from "./claude-api/typescript/claude-api/streaming.md";
import typescriptMaximoApiToolUse from "./claude-api/typescript/claude-api/tool-use.md";

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - claude-api/SKILL.md (Current Models pricing table)
//   - claude-api/shared/models.md (full model catalog with legacy versions and alias mappings)
export const SKILL_MODEL_VARS = {
  OPUS_ID: "claude-opus-4-6",
  OPUS_NAME: "Maximo Opus 4.6",
  SONNET_ID: "claude-sonnet-4-6",
  SONNET_NAME: "Maximo Sonnet 4.6",
  HAIKU_ID: "claude-haiku-4-5",
  HAIKU_NAME: "Maximo Haiku 4.5",
  // Previous Sonnet ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_SONNET_ID: "claude-sonnet-4-5",
} satisfies Record<string, string>;

export const SKILL_PROMPT: string = skillPrompt;

export const SKILL_FILES: Record<string, string> = {
  "csharp/claude-api.md": csharpMaximoApi,
  "curl/examples.md": curlExamples,
  "go/claude-api.md": goMaximoApi,
  "java/claude-api.md": javaMaximoApi,
  "php/claude-api.md": phpMaximoApi,
  "python/agent-sdk/README.md": pythonAgentSdkReadme,
  "python/agent-sdk/patterns.md": pythonAgentSdkPatterns,
  "python/claude-api/README.md": pythonMaximoApiReadme,
  "python/claude-api/batches.md": pythonMaximoApiBatches,
  "python/claude-api/files-api.md": pythonMaximoApiFilesApi,
  "python/claude-api/streaming.md": pythonMaximoApiStreaming,
  "python/claude-api/tool-use.md": pythonMaximoApiToolUse,
  "ruby/claude-api.md": rubyMaximoApi,
  "shared/error-codes.md": sharedErrorCodes,
  "shared/live-sources.md": sharedLiveSources,
  "shared/models.md": sharedModels,
  "shared/prompt-caching.md": sharedPromptCaching,
  "shared/tool-use-concepts.md": sharedToolUseConcepts,
  "typescript/agent-sdk/README.md": typescriptAgentSdkReadme,
  "typescript/agent-sdk/patterns.md": typescriptAgentSdkPatterns,
  "typescript/claude-api/README.md": typescriptMaximoApiReadme,
  "typescript/claude-api/batches.md": typescriptMaximoApiBatches,
  "typescript/claude-api/files-api.md": typescriptMaximoApiFilesApi,
  "typescript/claude-api/streaming.md": typescriptMaximoApiStreaming,
  "typescript/claude-api/tool-use.md": typescriptMaximoApiToolUse,
};
