/**
 * Maximo AI API model fetching service.
 *
 * Fetches available models from the Maximo AI API endpoint
 * and transforms them into model options for the CLI.
 */

import type { ModelOption } from "../../utils/model/modelOptions.js";
import {
  getGlobalConfig,
  saveGlobalConfig,
  type MyTabulonAccountInfo,
} from "../../utils/config.js";
import { logError } from "../../utils/log.js";
import {
  getMaximoAIOAuthTokens,
  isMaximoAIOpenAICompatibleProvider,
  isMaximoAISubscriber,
} from "../../utils/auth.js";
import type {
  OpenAICompatibleProvider,
  OpenCodePlan,
} from "../../utils/config.js";

// Response type from Maximo AI /v1/models endpoint
export interface MaximoModel {
  id: string;
  name?: string;
  hugging_face_id: string;
  created: number;
  description?: string;
  recommendation?: string;
  context_length?: number;
  max_context_length?: number;
  max_context_tokens?: number;
  max_input_tokens?: number;
  context_window?: number;
  max_output_length?: number;
  max_output_tokens?: number;
  max_completion_tokens?: number;
  max_tokens?: number;
  reasoning_efforts?: string[];
  reasoning?: {
    mandatory?: boolean;
    default_enabled?: boolean;
    supported_efforts?: string[];
    default_effort?: string | null;
  } | null;
  isPreview?: boolean;
  preview?: boolean;
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
  coding_plan?: MyTabulonCodingPlanResponse;
}

type MyTabulonCodingPlanResponse = {
  active?: boolean;
  tier?: string;
  plan_id?: string;
  name?: string;
  status?: string;
  concurrency?: number;
  models?: string[];
};

type MyTabulonContextResponse = {
  workspace?: {
    id?: string;
    name?: string;
  };
  user?: {
    id?: string;
    email?: string;
    username?: string;
    display_name?: string;
  } | null;
  coding_plan?: MyTabulonCodingPlanResponse;
  scopes?: string[];
};

type MyTabulonUsageResponse = MyTabulonCodingPlanResponse;

let cachedModels: MaximoModel[] | null = null;
let lastFetchTime = 0;
let cachedModelsBaseUrl: string | null = null;
let cachedMyTabulonAccount: MyTabulonAccountInfo | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MYTABULON_BASE_URL = "https://api.mytabulon.com/v1";
const CENCORI_BASE_URL = "https://api.cencori.com/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

// OpenCode publishes several protocol families from the same model catalog.
// The CLI transport intentionally uses only the models documented for its
// OpenAI-compatible Chat Completions endpoints. See opencode.ai/docs/zen and
// opencode.ai/docs/go for the protocol-specific model tables.
const OPENCODE_CHAT_COMPLETION_MODELS: Record<OpenCodePlan, ReadonlySet<string>> = {
  zen: new Set([
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "minimax-m3",
    "minimax-m2.7",
    "minimax-m2.5",
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k3",
    "big-pickle",
    "mimo-v2.5-free",
    "laguna-s-2.1-free",
    "ling-3.0-flash-free",
    "north-mini-code-free",
    "nemotron-3-ultra-free",
    "deepseek-v4-flash-free",
  ]),
  go: new Set([
    "grok-4.5",
    "glm-5.2",
    "glm-5.1",
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "mimo-v2.5",
    "mimo-v2.5-pro",
    "hy3",
  ]),
};

function normalizedBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || "").replace(/\/+$/, "").toLowerCase();
}

export function getOpenCodePlanForBaseUrl(
  baseUrl: string | undefined,
): OpenCodePlan | undefined {
  const normalized = normalizedBaseUrl(baseUrl);
  if (normalized === OPENCODE_GO_BASE_URL) return "go";
  if (normalized === OPENCODE_ZEN_BASE_URL) return "zen";
  return undefined;
}

export function getOpenAICompatibleProviderForBaseUrl(
  baseUrl: string | undefined,
): OpenAICompatibleProvider | undefined {
  const normalized = normalizedBaseUrl(baseUrl);
  if (normalized.includes("api.mytabulon.com")) return "mytabulon";
  if (normalized.includes("api.cencori.com")) return "cencori";
  if (normalized.includes("maximoai.co")) return "maximoai";
  if (normalized === OPENROUTER_BASE_URL) return "openrouter";
  if (getOpenCodePlanForBaseUrl(normalized)) return "opencode";
  return undefined;
}

export function isOpenCodeChatCompletionModel(
  model: MaximoModel,
  plan: OpenCodePlan,
): boolean {
  return OPENCODE_CHAT_COMPLETION_MODELS[plan].has(model.id);
}

function fallbackModelForProvider(
  provider: "openrouter" | "opencode",
): string {
  if (provider === "openrouter") return "openai/gpt-5.4";
  return "deepseek-v4-flash";
}

function chooseOpenRouterDefaultModel(models: MaximoModel[]): string {
  return (
    models.find((model) => model.id === "openai/gpt-5.4")?.id ||
    models.find((model) =>
      model.architecture?.output_modalities?.includes("text") &&
      model.supported_parameters?.includes("tools"),
    )?.id ||
    models[0]?.id ||
    fallbackModelForProvider("openrouter")
  );
}

export type MaximoModelLimits = {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

export type MaximoModelEffortConfig = {
  id: string;
  supportedEfforts: string[];
  defaultEffort?: string;
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
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

function normalizeModelId(model: string): string {
  return model.replace(/\[1m\]/gi, "").trim().toLowerCase();
}

export function getCachedMaximoModel(model: string): MaximoModel | undefined {
  const currentBaseUrl = getMaximoAIBaseUrl().replace(/\/+$/, "");
  if (
    !cachedModels ||
    cachedModels.length === 0 ||
    cachedModelsBaseUrl !== currentBaseUrl
  ) {
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
  const advertisedMaxOutputTokens =
    getMaximoModelMaxOutputLength(maximoModel);
  // A provider occasionally reports its total context window through a
  // generic max_tokens field as well. Treating that as an output allowance
  // reserves the entire context window for a compact summary, which makes the
  // effective window (and auto-compact threshold) zero.
  const maxOutputTokens =
    advertisedMaxOutputTokens &&
    (!contextWindow || advertisedMaxOutputTokens < contextWindow)
      ? advertisedMaxOutputTokens
      : undefined;
  if (!contextWindow && !maxOutputTokens) {
    return undefined;
  }

  return {
    id: maximoModel.id,
    contextWindow,
    maxOutputTokens,
  };
}

function normalizeEffortName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (normalized === "extrahigh" || normalized === "ultra") return "xhigh";
  if (normalized === "maximum") return "max";
  if (normalized === "med") return "medium";
  return normalized;
}

export function getCachedMaximoModelEffortConfig(
  model: string
): MaximoModelEffortConfig | undefined {
  const maximoModel = getCachedMaximoModel(model);
  if (!maximoModel) {
    return undefined;
  }

  const advertisedEfforts =
    maximoModel.reasoning?.supported_efforts ??
    maximoModel.reasoning_efforts ??
    [];
  const supportedEfforts = [
    ...new Set(
      advertisedEfforts
        .filter((value): value is string => typeof value === "string")
        .map(normalizeEffortName)
        .filter(Boolean)
    ),
  ];
  const rawDefault = maximoModel.reasoning?.default_effort;
  const defaultEffort =
    typeof rawDefault === "string" && rawDefault.trim()
      ? normalizeEffortName(rawDefault)
      : undefined;

  return {
    id: maximoModel.id,
    supportedEfforts,
    ...(defaultEffort ? { defaultEffort } : {}),
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

  if (isMyTabulonProvider()) {
    return true;
  }

  if (isCencoriProvider()) {
    return true;
  }

  if (isOpenRouterProvider() || isOpenCodeProvider()) {
    return true;
  }

  const oauthTokens = getMaximoAIOAuthTokens();
  if (oauthTokens?.accessToken && isMaximoAISubscriber()) {
    return true;
  }

  return false;
}

export function isMyTabulonProvider(): boolean {
  const globalConfig = getGlobalConfig();
  const baseUrl =
    process.env.OPENAI_BASE_URL || globalConfig.openAIBaseUrl || "";
  const hasOpenAIConfig =
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "1" ||
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "true" ||
    Boolean(globalConfig.maximoApiKey);
  return hasOpenAIConfig && baseUrl.includes("api.mytabulon.com");
}

/**
 * Check if we're using Cencori as the OpenAI-compatible provider.
 * Cencori exposes an OpenAI-compatible /v1 API (https://api.cencori.com/v1).
 */
export function isCencoriProvider(): boolean {
  const globalConfig = getGlobalConfig();
  const baseUrl =
    process.env.OPENAI_BASE_URL || globalConfig.openAIBaseUrl || "";
  const hasOpenAIConfig =
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "1" ||
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "true" ||
    Boolean(globalConfig.cencoriApiKey);
  return hasOpenAIConfig && baseUrl.includes("api.cencori.com");
}

/** Check if we're using OpenRouter as the OpenAI-compatible provider. */
export function isOpenRouterProvider(): boolean {
  const globalConfig = getGlobalConfig();
  const baseUrl =
    process.env.OPENAI_BASE_URL || globalConfig.openAIBaseUrl || "";
  const hasOpenAIConfig =
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "1" ||
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "true" ||
    Boolean(globalConfig.maximoApiKey);
  return (
    hasOpenAIConfig &&
    getOpenAICompatibleProviderForBaseUrl(baseUrl) === "openrouter"
  );
}

/** Check if we're using OpenCode Go or Zen as the OpenAI-compatible provider. */
export function isOpenCodeProvider(): boolean {
  const globalConfig = getGlobalConfig();
  const baseUrl =
    process.env.OPENAI_BASE_URL || globalConfig.openAIBaseUrl || "";
  const hasOpenAIConfig =
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "1" ||
    process.env.MAXIMO_SYNTAX_USE_OPENAI === "true" ||
    Boolean(globalConfig.maximoApiKey);
  return (
    hasOpenAIConfig &&
    getOpenAICompatibleProviderForBaseUrl(baseUrl) === "opencode"
  );
}

/**
 * Get the base URL for Maximo AI API
 */
export function getMaximoAIBaseUrl(): string {
  const globalConfig = getGlobalConfig();
  const configuredBaseUrl =
    globalConfig.openAIBaseUrl || process.env.OPENAI_BASE_URL;
  return configuredBaseUrl?.includes("maximoai.co") ||
    configuredBaseUrl?.includes("api.mytabulon.com") ||
    configuredBaseUrl?.includes("api.cencori.com") ||
    configuredBaseUrl?.includes("openrouter.ai/api/v1") ||
    configuredBaseUrl?.includes("opencode.ai/zen/")
    ? configuredBaseUrl
    : "https://api.maximoai.co/v1";
}

/**
 * Get the API key for Maximo AI
 */
export function getMaximoApiKey(): string | undefined {
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
export async function fetchMaximoModels({
  baseUrl: baseUrlOverride,
  apiKey: apiKeyOverride,
  forceRefresh = false,
  persistMyTabulonAccount = true,
  throwOnError = false,
}: {
  baseUrl?: string;
  apiKey?: string;
  forceRefresh?: boolean;
  persistMyTabulonAccount?: boolean;
  throwOnError?: boolean;
} = {}): Promise<MaximoModel[]> {
  const baseUrl = (baseUrlOverride || getMaximoAIBaseUrl()).replace(/\/+$/, "");

  // Return cached results if still valid
  if (
    !forceRefresh &&
    cachedModels &&
    cachedModelsBaseUrl === baseUrl &&
    Date.now() - lastFetchTime < CACHE_TTL
  ) {
    return cachedModels;
  }

  const apiKey = apiKeyOverride || getMaximoApiKey();

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

    const provider = getOpenAICompatibleProviderForBaseUrl(baseUrl);
    const openCodePlan = getOpenCodePlanForBaseUrl(baseUrl);
    const compatibleModels =
      provider === "opencode" && openCodePlan
        ? models.filter((model) =>
            isOpenCodeChatCompletionModel(model, openCodePlan),
          )
        : models;

    if (provider === "opencode" && compatibleModels.length === 0) {
      throw new Error(
        `OpenCode ${openCodePlan === "go" ? "Go" : "Zen"} returned no models supported by its Chat Completions endpoint.`,
      );
    }

    // Sort models by name, prioritizing non-preview models
    const sortedModels =
      provider === "mytabulon" || provider === "openrouter" || provider === "opencode"
        ? [...compatibleModels]
        : [...compatibleModels].sort((a, b) => {
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
    cachedModelsBaseUrl = baseUrl;
    lastFetchTime = Date.now();

    if (baseUrl.includes("api.mytabulon.com") && apiKey) {
      const account = await refreshMyTabulonAccount({
        apiKey,
        baseUrl,
        models: sortedModels,
        modelsPlan: Array.isArray(data) ? undefined : data.coding_plan,
      });
      cachedMyTabulonAccount = account;
      if (persistMyTabulonAccount) {
        persistMyTabulonState(apiKey, baseUrl, sortedModels, account);
      }
    }

    return sortedModels;
  } catch (error) {
    logError(error as Error);
    if (throwOnError) {
      throw error;
    }
    // Never show a different provider's catalog after a provider switch.
    return cachedModelsBaseUrl === baseUrl ? cachedModels || [] : [];
  }
}

/**
 * Clear the cached models (e.g., when config changes)
 */
export function clearMaximoModelsCache(): void {
  cachedModels = null;
  cachedModelsBaseUrl = null;
  cachedMyTabulonAccount = null;
  lastFetchTime = 0;
}

/**
 * Get a short, user-friendly label from the full model name
 */
function getShortLabel(fullName: string | undefined, modelId: string): string {
  // Extract the model variant name after "Maximo AI:"
  const match = fullName?.match(/Maximo AI:\s*(.+)/);
  if (match) {
    return match[1];
  }

  if (fullName?.trim()) {
    return fullName.trim();
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

  let description =
    model.description ||
    model.recommendation ||
    "Available through the configured model provider";

  // Truncate very long descriptions
  if (description.length > 120) {
    description = description.slice(0, 117) + "...";
  }

  // Add preview tag for preview models
  if (model.isPreview || model.preview) {
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
    descriptionForModel: `${label} - ${description}`,
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

  if (
    isMyTabulonProvider() ||
    isCencoriProvider() ||
    isOpenRouterProvider() ||
    isOpenCodeProvider()
  ) {
    // External model IDs do not follow Maximo's family naming scheme.
    return models.map(toModelOption);
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
  const currentBaseUrl = getMaximoAIBaseUrl().replace(/\/+$/, "");
  if (
    !cachedModels ||
    cachedModels.length === 0 ||
    cachedModelsBaseUrl !== currentBaseUrl
  ) {
    return null;
  }

  return cachedModels.map(toModelOption);
}

function codingPlanName(tier: string): string {
  switch (tier.toLowerCase()) {
    case "max":
      return "Coding Max";
    case "pro":
      return "Coding Pro";
    case "plus":
      return "Coding Plus";
    default:
      return "Coding Free";
  }
}

async function fetchMyTabulonJson<T>({
  baseUrl,
  path,
  apiKey,
}: {
  baseUrl: string;
  path: string;
  apiKey: string;
}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const data = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error?.message
        ? data.error.message
        : `MyTabulon returned ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  if (!data) {
    throw new Error("MyTabulon returned an empty response.");
  }
  return data as T;
}

async function refreshMyTabulonAccount({
  apiKey,
  baseUrl,
  models,
  modelsPlan,
}: {
  apiKey: string;
  baseUrl: string;
  models: MaximoModel[];
  modelsPlan?: MyTabulonCodingPlanResponse;
}): Promise<MyTabulonAccountInfo> {
  const [contextResult, usageResult] = await Promise.allSettled([
    fetchMyTabulonJson<MyTabulonContextResponse>({
      baseUrl,
      path: "/me",
      apiKey,
    }),
    fetchMyTabulonJson<MyTabulonUsageResponse>({
      baseUrl,
      path: "/coding-plan/usage",
      apiKey,
    }),
  ]);
  const context =
    contextResult.status === "fulfilled" ? contextResult.value : undefined;
  const usage =
    usageResult.status === "fulfilled" ? usageResult.value : undefined;
  const previous = getGlobalConfig().mytabulonAccount;
  const plan = context?.coding_plan || usage || modelsPlan || {};
  const tier = String(
    plan.tier || previous?.codingPlanTier || "free"
  ).toLowerCase();
  return {
    userId: context?.user?.id || previous?.userId,
    emailAddress: context?.user?.email || previous?.emailAddress,
    displayName: context?.user?.display_name || previous?.displayName,
    username: context?.user?.username || previous?.username,
    workspaceId: context?.workspace?.id || previous?.workspaceId,
    workspaceName: context?.workspace?.name || previous?.workspaceName,
    codingPlanActive:
      typeof plan.active === "boolean"
        ? plan.active
        : previous?.codingPlanActive ?? true,
    codingPlanTier: tier,
    codingPlanId: String(
      plan.plan_id || previous?.codingPlanId || `coding_${tier}_v1`
    ),
    codingPlanName: String(
      plan.name || previous?.codingPlanName || codingPlanName(tier)
    ),
    scopes: Array.isArray(context?.scopes)
      ? context.scopes
      : previous?.scopes || [],
    updatedAt: new Date().toISOString(),
  };
}

function persistMyTabulonState(
  apiKey: string,
  baseUrl: string,
  models: MaximoModel[],
  account: MyTabulonAccountInfo
): void {
  const defaultModel =
    models.find((model) => model.id === "maximo-atlas-preview")?.id ||
    models[0]?.id ||
    "maximo-atlas-preview";
  process.env.MAXIMO_SYNTAX_USE_OPENAI = "1";
  process.env.OPENAI_API_KEY = apiKey;
  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.OPENAI_MODEL = defaultModel;
  saveGlobalConfig((current) => ({
    ...current,
    maximoApiKey: apiKey,
    openAIBaseUrl: baseUrl,
    openAIProvider: "mytabulon",
    openCodePlan: undefined,
    openAIModel: undefined,
    mytabulonDefaultModel: defaultModel,
    mytabulonAccount: account,
    cencoriApiKey: undefined,
  }));
}

export async function configureMyTabulonProvider(
  apiKey: string
): Promise<MyTabulonAccountInfo> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey.startsWith("mtb_live_")) {
    throw new Error(
      "MyTabulon Coding Plan requires a live API key beginning with mtb_live_."
    );
  }
  clearMaximoModelsCache();
  const models = await fetchMaximoModels({
    baseUrl: MYTABULON_BASE_URL,
    apiKey: trimmedKey,
    forceRefresh: true,
    persistMyTabulonAccount: false,
    throwOnError: true,
  });
  if (models.length === 0) {
    throw new Error("No models are available for this MyTabulon Coding Plan.");
  }
  const account = cachedMyTabulonAccount;
  if (!account) {
    throw new Error("MyTabulon account details could not be loaded.");
  }
  if (!account.scopes.includes("ai.coding")) {
    throw new Error(
      "This MyTabulon API key is missing the ai.coding scope. Enable Coding Plan access for the key in the API Platform dashboard."
    );
  }
  persistMyTabulonState(trimmedKey, MYTABULON_BASE_URL, models, account);
  return account;
}

function persistCencoriState(
  apiKey: string,
  baseUrl: string,
  model?: string
): void {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = "1";
  process.env.OPENAI_API_KEY = apiKey;
  process.env.OPENAI_BASE_URL = baseUrl;
  if (model) process.env.OPENAI_MODEL = model;
  saveGlobalConfig((current) => ({
    ...current,
    cencoriApiKey: apiKey,
    maximoApiKey: apiKey,
    openAIBaseUrl: baseUrl,
    openAIProvider: "cencori",
    openAIModel: model ?? current.openAIModel,
    openCodePlan: undefined,
    mytabulonDefaultModel: undefined,
    mytabulonAccount: undefined,
  }));
}

export type ConfigureCencoriResult = {
  models: MaximoModel[];
  defaultModel?: string;
  /** Present when the key was accepted but /v1/models could not be read.
   *  Login still succeeds — the user can pick a model later. */
  warning?: string;
};

/**
 * Configure the CLI to use Cencori as an OpenAI-compatible provider.
 *
 * Validates the key, then fetches the available models from Cencori to pick a
 * sensible default. A failure to list models (e.g. a 401 on /v1/models while
 * the key is still valid, network blip, schematic surprise) MUST NOT block
 * login — we persist the key and return with a warning so the user can get
 * started immediately and choose a model later.
 */
export async function configureCencoriProvider(
  apiKey: string
): Promise<ConfigureCencoriResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("Enter your Cencori API key.");
  }
  if (!trimmedKey.startsWith("csk_")) {
    throw new Error(
      "Cencori API keys begin with csk_. Check you copied the right key from api.cencori.com."
    );
  }
  clearMaximoModelsCache();
  try {
    const models = await fetchMaximoModels({
      baseUrl: CENCORI_BASE_URL,
      apiKey: trimmedKey,
      forceRefresh: true,
      persistMyTabulonAccount: false,
      throwOnError: true,
    });
    const defaultModel = models[0]?.id;
    persistCencoriState(trimmedKey, CENCORI_BASE_URL, defaultModel);
    return { models, defaultModel };
  } catch (error) {
    // The key may still be valid (e.g. /v1/models returns 401 for some keys
    // while /v1/chat/completions works). Persist auth so login succeeds; the
    // chat layer uses OPENAI_MODEL if the user sets one later.
    persistCencoriState(trimmedKey, CENCORI_BASE_URL);
    const reason =
      error instanceof Error ? error.message : "unknown error";
    return {
      models: [],
      warning:
        "Connected to Cencori, but couldn't read the model list " +
        `(${reason}). You're logged in — pick a model when you start a session.`,
    };
  }
}

export type ConfigureOpenAICompatibleResult = {
  models: MaximoModel[];
  defaultModel?: string;
  /** Present when credentials were saved but the provider catalog was unavailable. */
  warning?: string;
};

function persistExternalProviderState({
  apiKey,
  baseUrl,
  provider,
  plan,
  model,
}: {
  apiKey: string;
  baseUrl: string;
  provider: "openrouter" | "opencode";
  plan?: OpenCodePlan;
  model?: string;
}): void {
  const defaultModel = model || fallbackModelForProvider(provider);
  process.env.MAXIMO_SYNTAX_USE_OPENAI = "1";
  process.env.OPENAI_API_KEY = apiKey;
  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.OPENAI_MODEL = defaultModel;
  saveGlobalConfig((current) => ({
    ...current,
    maximoApiKey: apiKey,
    openAIBaseUrl: baseUrl,
    openAIProvider: provider,
    openAIModel: defaultModel,
    openCodePlan: provider === "opencode" ? plan : undefined,
    cencoriApiKey: undefined,
    mytabulonDefaultModel: undefined,
    mytabulonAccount: undefined,
    oauthAccount: undefined,
  }));
}

async function configureExternalProvider({
  apiKey,
  baseUrl,
  provider,
  plan,
}: {
  apiKey: string;
  baseUrl: string;
  provider: "openrouter" | "opencode";
  plan?: OpenCodePlan;
}): Promise<ConfigureOpenAICompatibleResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error(
      `Enter your ${provider === "openrouter" ? "OpenRouter" : "OpenCode"} API key.`,
    );
  }

  clearMaximoModelsCache();
  try {
    const models = await fetchMaximoModels({
      baseUrl,
      apiKey: trimmedKey,
      forceRefresh: true,
      persistMyTabulonAccount: false,
      throwOnError: true,
    });
    if (models.length === 0) {
      throw new Error("The provider returned no usable Chat Completions models.");
    }
    const defaultModel =
      provider === "openrouter"
        ? chooseOpenRouterDefaultModel(models)
        : models[0]?.id || fallbackModelForProvider(provider);
    persistExternalProviderState({
      apiKey: trimmedKey,
      baseUrl,
      provider,
      plan,
      model: defaultModel,
    });
    return { models, defaultModel };
  } catch (error) {
    if (
      error instanceof Error &&
      /Failed to fetch models: (401|403)\b/.test(error.message)
    ) {
      throw error;
    }
    const fallbackModel = fallbackModelForProvider(provider);
    persistExternalProviderState({
      apiKey: trimmedKey,
      baseUrl,
      provider,
      plan,
      model: fallbackModel,
    });
    const providerLabel = provider === "openrouter" ? "OpenRouter" : `OpenCode ${plan === "go" ? "Go" : "Zen"}`;
    const reason = error instanceof Error ? error.message : "unknown error";
    return {
      models: [],
      defaultModel: fallbackModel,
      warning:
        `Connected to ${providerLabel}, but couldn't read the model list ` +
        `(${reason}). You're logged in — refresh the model list before choosing a model.`,
    };
  }
}

/** Configure OpenRouter through its OpenAI-compatible Chat Completions API. */
export function configureOpenRouterProvider(
  apiKey: string,
): Promise<ConfigureOpenAICompatibleResult> {
  return configureExternalProvider({
    apiKey,
    baseUrl: OPENROUTER_BASE_URL,
    provider: "openrouter",
  });
}

/** Configure OpenCode Go or Zen through its Chat Completions endpoint. */
export function configureOpenCodeProvider(
  apiKey: string,
  plan: OpenCodePlan = "zen",
): Promise<ConfigureOpenAICompatibleResult> {
  return configureExternalProvider({
    apiKey,
    baseUrl: plan === "go" ? OPENCODE_GO_BASE_URL : OPENCODE_ZEN_BASE_URL,
    provider: "opencode",
    plan,
  });
}

/**
 * Pre-fetch models in the background (call at app startup)
 */
export function prefetchMaximoModels(): void {
  if (isMaximoAIProviderInternal()) {
    void fetchMaximoModels();
  }
}
