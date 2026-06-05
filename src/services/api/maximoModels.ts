/**
 * Maximo AI API model fetching service.
 *
 * Fetches available models from the Maximo AI API endpoint
 * and transforms them into model options for the CLI.
 */

import type { ModelOption } from "../../utils/model/modelOptions.js";
import { getGlobalConfig } from "../../utils/config.js";
import { logError } from "../../utils/log.js";
import {
  getMaximoAIOAuthTokens,
  isMaximoAIOpenAICompatibleProvider,
  isMaximoAISubscriber,
} from "../../utils/auth.js";

// Response type from Maximo AI /v1/models endpoint
export interface MaximoModel {
  id: string;
  name: string;
  hugging_face_id: string;
  created: number;
  description: string;
  context_length?: number;
  max_context_length?: number;
  max_context_tokens?: number;
  max_input_tokens?: number;
  context_window?: number;
  max_output_length?: number;
  max_output_tokens?: number;
  max_completion_tokens?: number;
  max_tokens?: number;
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

export type MaximoModelLimits = {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

function firstPositiveInteger(
  ...values: Array<number | null | undefined>
): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return undefined;
}

function getMaximoModelContextLength(model: MaximoModel): number | undefined {
  return firstPositiveInteger(
    model.context_length,
    model.max_context_length,
    model.max_context_tokens,
    model.max_input_tokens,
    model.context_window,
    model.top_provider?.context_length
  );
}

function getMaximoModelMaxOutputLength(model: MaximoModel): number | undefined {
  return firstPositiveInteger(
    model.max_output_length,
    model.max_output_tokens,
    model.max_completion_tokens,
    model.max_tokens,
    model.top_provider?.max_completion_tokens
  );
}

function getModelMatchKeys(model: MaximoModel): string[] {
  return [
    model.id,
    model.canonical_slug,
    model.openrouter?.slug,
    model.hugging_face_id,
  ].filter((value): value is string => typeof value === "string" && value);
}

function normalizeModelId(model: string): string {
  return model.replace(/\[1m\]/gi, "").trim().toLowerCase();
}

export function getCachedMaximoModel(model: string): MaximoModel | undefined {
  if (!cachedModels || cachedModels.length === 0) {
    return undefined;
  }

  const normalized = normalizeModelId(model);
  if (!normalized) {
    return undefined;
  }

  for (const candidate of cachedModels) {
    if (
      getModelMatchKeys(candidate).some(
        (key) => key.toLowerCase() === normalized
      )
    ) {
      return candidate;
    }
  }

  const sorted = [...cachedModels].sort(
    (a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id)
  );
  return sorted.find((candidate) =>
    getModelMatchKeys(candidate).some((key) => {
      const normalizedKey = key.toLowerCase();
      return (
        normalizedKey.length > 0 &&
        (normalized.includes(normalizedKey) ||
          normalizedKey.includes(normalized))
      );
    })
  );
}

export function getCachedMaximoModelLimits(
  model: string
): MaximoModelLimits | undefined {
  const maximoModel = getCachedMaximoModel(model);
  if (!maximoModel) {
    return undefined;
  }

  const contextWindow = getMaximoModelContextLength(maximoModel);
  const maxOutputTokens = getMaximoModelMaxOutputLength(maximoModel);
  if (!contextWindow && !maxOutputTokens) {
    return undefined;
  }

  return {
    id: maximoModel.id,
    contextWindow,
    maxOutputTokens,
  };
}

/**
 * Check if we're using Maximo AI provider (via OpenAI-compatible endpoint)
 * This is duplicated from model.ts to avoid circular imports
 */
function isMaximoAIProviderInternal(): boolean {
  if (isMaximoAIOpenAICompatibleProvider()) {
    return true;
  }

  const oauthTokens = getMaximoAIOAuthTokens();
  if (oauthTokens?.accessToken && isMaximoAISubscriber()) {
    return true;
  }

  return false;
}

/**
 * Get the base URL for Maximo AI API
 */
function getMaximoAIBaseUrl(): string {
  const globalConfig = getGlobalConfig();
  const configuredBaseUrl =
    globalConfig.openAIBaseUrl || process.env.OPENAI_BASE_URL;
  return configuredBaseUrl?.includes("maximoai.co")
    ? configuredBaseUrl
    : "https://api.maximoai.co/v1";
}

/**
 * Get the API key for Maximo AI
 */
function getMaximoApiKey(): string | undefined {
  const globalConfig = getGlobalConfig();
  return (
    globalConfig.maximoApiKey ||
    getMaximoAIOAuthTokens()?.accessToken ||
    process.env.OPENAI_API_KEY
  );
}

/**
 * Fetch available models from the Maximo AI API
 */
export async function fetchMaximoModels(): Promise<MaximoModel[]> {
  // Return cached results if still valid
  if (cachedModels && Date.now() - lastFetchTime < CACHE_TTL) {
    return cachedModels;
  }

  const baseUrl = getMaximoAIBaseUrl().replace(/\/+$/, "");
  const apiKey = getMaximoApiKey();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/models`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as MaximoModelsResponse | MaximoModel[];
    const models = Array.isArray(data) ? data : data.data;

    if (!Array.isArray(models)) {
      throw new Error("Failed to fetch models: malformed response");
    }

    // Sort models by name, prioritizing non-preview models
    const sortedModels = [...models].sort((a, b) => {
      // Prioritize Pandora models for coding
      const aIsPandora = a.id.includes("pandora");
      const bIsPandora = b.id.includes("pandora");

      if (aIsPandora && !bIsPandora) return -1;
      if (!aIsPandora && bIsPandora) return 1;

      // Then prioritize non-preview models
      if (a.isPreview && !b.isPreview) return 1;
      if (!a.isPreview && b.isPreview) return -1;

      // Then sort by name
      return (a.name || a.id).localeCompare(b.name || b.id);
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

  const contextLength = getMaximoModelContextLength(model);
  const outputLength = getMaximoModelMaxOutputLength(model);
  const limitParts = [
    contextLength ? `${Math.round(contextLength / 1000)}K context` : undefined,
    outputLength ? `${Math.round(outputLength / 1000)}K output` : undefined,
  ].filter((part): part is string => Boolean(part));
  const limitsDescription =
    limitParts.length > 0 ? ` · ${limitParts.join(" · ")}` : "";

  return {
    value: model.id,
    label,
    description: `${description}${limitsDescription}`,
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
