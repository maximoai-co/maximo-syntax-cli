/**
 * Maximo AI API model fetching service.
 *
 * Fetches available models from the Maximo AI API endpoint
 * and transforms them into model options for the CLI.
 */

import type { ModelOption } from "../../utils/model/modelOptions.js";
import { getGlobalConfig } from "../../utils/config.js";
import { logError } from "../../utils/log.js";
import { getAPIProvider } from "../../utils/model/providers.js";

// Response type from Maximo AI /v1/models endpoint
export interface MaximoModel {
  id: string;
  name: string;
  hugging_face_id: string;
  created: number;
  description: string;
  context_length: number;
  max_output_length: number;
  isPreview?: boolean;
  earlyAccess?: boolean;
  isResearchPreview?: boolean;
  quantization: string;
  input_modalities: string[];
  output_modalities: string[];
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    video?: string;
    audio?: string;
    request?: string;
    input_cache_reads?: string;
    input_cache_writes?: string;
    web_search?: string;
    internal_reasoning?: string;
    promptTierThreshold?: number;
    promptTierHigh?: string;
    completionTierHigh?: string;
  };
  supported_sampling_parameters: string[];
  supported_features: string[];
  openrouter: {
    slug: string;
  };
  datacenters: Array<{ country_code: string }>;
  canonical_slug: string;
  top_provider: {
    context_length: number;
    max_completion_tokens: number;
    is_moderated: boolean;
  };
  per_request_limits: null;
  supported_parameters: string[];
  default_parameters: {
    temperature: number;
    top_p: number;
    frequency_penalty: number;
    presence_penalty: number;
  };
}

interface MaximoModelsResponse {
  data: MaximoModel[];
}

let cachedModels: MaximoModel[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if we're using Maximo AI provider (via OpenAI-compatible endpoint)
 * This is duplicated from model.ts to avoid circular imports
 */
function isMaximoAIProviderInternal(): boolean {
  const provider = process.env.CLAUDE_CODE_USE_OPENAI
    ? "openai"
    : process.env.CLAUDE_CODE_USE_GEMINI
    ? "gemini"
    : process.env.CLAUDE_CODE_USE_BEDROCK
    ? "bedrock"
    : process.env.CLAUDE_CODE_USE_VERTEX
    ? "vertex"
    : process.env.CLAUDE_CODE_USE_FOUNDRY
    ? "foundry"
    : "firstParty";
  const baseUrl = process.env.OPENAI_BASE_URL || "";

  // Check if we're using the Maximo AI API endpoint
  if (
    provider === "openai" &&
    (baseUrl.includes("api.maximoai.co") || baseUrl.includes("maximoai.co"))
  ) {
    return true;
  }

  // Check if using Maximo AI OAuth config
  const globalConfig = getGlobalConfig();
  if (
    globalConfig.maximoApiKey &&
    (globalConfig.openAIBaseUrl?.includes("maximoai.co") ||
      baseUrl.includes("maximoai.co"))
  ) {
    return true;
  }

  return false;
}

/**
 * Get the base URL for Maximo AI API
 */
function getMaximoAIBaseUrl(): string {
  const globalConfig = getGlobalConfig();
  return (
    globalConfig.openAIBaseUrl ||
    process.env.OPENAI_BASE_URL ||
    "https://api.maximoai.co/v1"
  );
}

/**
 * Get the API key for Maximo AI
 */
function getMaximoApiKey(): string | undefined {
  const globalConfig = getGlobalConfig();
  return globalConfig.maximoApiKey || process.env.OPENAI_API_KEY;
}

/**
 * Fetch available models from the Maximo AI API
 */
export async function fetchMaximoModels(): Promise<MaximoModel[]> {
  // Return cached results if still valid
  if (cachedModels && Date.now() - lastFetchTime < CACHE_TTL) {
    return cachedModels;
  }

  const baseUrl = getMaximoAIBaseUrl();
  const apiKey = getMaximoApiKey();

  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as MaximoModelsResponse;

    // Sort models by name, prioritizing non-preview models
    const sortedModels = data.data.sort((a, b) => {
      // Prioritize Pandora models for coding
      const aIsPandora = a.id.includes("pandora");
      const bIsPandora = b.id.includes("pandora");

      if (aIsPandora && !bIsPandora) return -1;
      if (!aIsPandora && bIsPandora) return 1;

      // Then prioritize non-preview models
      if (a.isPreview && !b.isPreview) return 1;
      if (!a.isPreview && b.isPreview) return -1;

      // Then sort by name
      return a.name.localeCompare(b.name);
    });

    cachedModels = sortedModels;
    lastFetchTime = Date.now();

    return sortedModels;
  } catch (error) {
    logError(error as Error);
    // Return cached models if available, even if expired
    return cachedModels || [];
  }
}

/**
 * Clear the cached models (e.g., when config changes)
 */
export function clearMaximoModelsCache(): void {
  cachedModels = null;
  lastFetchTime = 0;
}

/**
 * Format pricing for display
 */
function formatPricing(model: MaximoModel): string {
  const promptPrice = parseFloat(model.pricing.prompt);
  const completionPrice = parseFloat(model.pricing.completion);

  // Convert to per 1M tokens for readability
  const promptPer1M = (promptPrice * 1000000).toFixed(2);
  const completionPer1M = (completionPrice * 1000000).toFixed(2);

  return `$${promptPer1M} / $${completionPer1M} per 1M tokens`;
}

/**
 * Get a short, user-friendly label from the full model name
 */
function getShortLabel(fullName: string, modelId: string): string {
  // Extract the model variant name after "Maximo AI:"
  const match = fullName.match(/Maximo AI:\s*(.+)/);
  if (match) {
    return match[1];
  }

  // Fallback to capitalized model ID
  return modelId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Transform a Maximo model into a ModelOption
 */
function toModelOption(model: MaximoModel): ModelOption {
  const label = getShortLabel(model.name, model.id);

  let description = model.description;

  // Truncate very long descriptions
  if (description.length > 120) {
    description = description.slice(0, 117) + "...";
  }

  // Add preview tag for preview models
  if (model.isPreview) {
    description = `[Preview] ${description}`;
  }

  // Add context length info
  const contextInK = Math.round(model.context_length / 1000);
  const outputInK = Math.round(model.max_output_length / 1000);

  return {
    value: model.id,
    label,
    description: `${description} · ${contextInK}K context · ${outputInK}K output`,
    descriptionForModel: `${model.name} - ${model.description}`,
  };
}

/**
 * Get model options from the Maximo AI API
 * Returns null if not using Maximo AI provider or if fetching fails
 */
export async function getMaximoModelOptions(): Promise<ModelOption[] | null> {
  if (!isMaximoAIProviderInternal()) {
    return null;
  }

  const models = await fetchMaximoModels();

  if (models.length === 0) {
    return null;
  }

  // Group models by family (Pandora, Alpha, Beta, Astra, etc.)
  const groupedModels: Record<string, MaximoModel[]> = {};

  for (const model of models) {
    // Extract family from model ID (e.g., "maximo-pandora-3.5" -> "pandora")
    const match = model.id.match(/maximo-(\w+)-/);
    const family = match ? match[1] : "other";

    if (!groupedModels[family]) {
      groupedModels[family] = [];
    }
    groupedModels[family].push(model);
  }

  // Transform into options, prioritizing certain families
  const options: ModelOption[] = [];

  // Define priority order for families
  const familyPriority = ["pandora", "astra", "beta", "alpha"];

  // Add models in priority order
  for (const family of familyPriority) {
    if (groupedModels[family]) {
      // Sort within family by version (newest first)
      groupedModels[family].sort((a, b) => {
        // Extract version numbers
        const aVersion = a.id.match(/(\d+\.?\d*)/)?.[1] || "0";
        const bVersion = b.id.match(/(\d+\.?\d*)/)?.[1] || "0";
        return parseFloat(bVersion) - parseFloat(aVersion);
      });

      for (const model of groupedModels[family]) {
        options.push(toModelOption(model));
      }
    }
  }

  // Add any remaining models not in priority families
  for (const [family, models] of Object.entries(groupedModels)) {
    if (!familyPriority.includes(family)) {
      for (const model of models) {
        options.push(toModelOption(model));
      }
    }
  }

  return options;
}

/**
 * Synchronous version that returns cached models if available
 * Used for initial render when we can't wait for async fetch
 */
export function getCachedMaximoModelOptions(): ModelOption[] | null {
  if (!cachedModels || cachedModels.length === 0) {
    return null;
  }

  return cachedModels.map(toModelOption);
}

/**
 * Pre-fetch models in the background (call at app startup)
 */
export function prefetchMaximoModels(): void {
  if (isMaximoAIProviderInternal()) {
    void fetchMaximoModels();
  }
}
