import axios from "axios";
import { getOauthConfig } from "../../constants/oauth.js";
import {
  getMaximoAIOAuthTokens,
  hasProfileScope,
  isMaximoAISubscriber,
  getAnthropicApiKey,
} from "../../utils/auth.js";
import { getAuthHeaders } from "../../utils/http.js";
import { getMaximoCodeUserAgent } from "../../utils/userAgent.js";
import {
  isOAuthTokenExpired,
  MAXIMO_OAUTH_CONFIG,
  shouldUseMaximoAIAuth,
} from "../oauth/client.js";
import { getGlobalConfig } from "../../utils/config.js";
import { isEnvTruthy } from "../../utils/envUtils.js";

/**
 * Get the correct base API URL for usage endpoints.
 * For Maximo AI users (Option 1 or Option 2), use api.maximoai.co.
 * For Anthropic OAuth users, use the standard Anthropic API.
 */
function getUsageApiBaseUrl(): string {
  // Check if using Maximo AI Option 2 (OAuth login with Maximo)
  const tokens = getMaximoAIOAuthTokens();
  if (tokens?.scopes && shouldUseMaximoAIAuth(tokens.scopes)) {
    return MAXIMO_OAUTH_CONFIG.BASE_API_URL;
  }

  // Check if using Maximo AI Option 1 (OpenAI-compatible API)
  if (isEnvTruthy(process.env.MAXIMO_SYNTAX_USE_OPENAI)) {
    const baseUrl =
      process.env.OPENAI_BASE_URL || getGlobalConfig().openAIBaseUrl;
    if (baseUrl?.includes("maximoai.co")) {
      // Use the main Maximo API base URL (without /v1 suffix)
      return MAXIMO_OAUTH_CONFIG.BASE_API_URL;
    }
  }

  // Check if user has Maximo API key configured
  const globalConfig = getGlobalConfig();
  if (
    globalConfig.maximoApiKey ||
    globalConfig.openAIBaseUrl?.includes("maximoai.co")
  ) {
    return MAXIMO_OAUTH_CONFIG.BASE_API_URL;
  }

  // Default to standard OAuth config ( Anthropic)
  return getOauthConfig().BASE_API_URL;
}

/**
 * Check if the user has any OpenAI-compatible API key from Maximo AI.
 * Used for Option 1 users who set OPENAI_API_KEY with Maximo endpoint.
 */
function hasMaximoApiKey(): boolean {
  // Check for OPENAI_API_KEY when using OpenAI-compatible mode with Maximo
  console.log("[Usage] hasMaximoApiKey check:", {
    useOpenAI: isEnvTruthy(process.env.MAXIMO_SYNTAX_USE_OPENAI),
    baseUrl: process.env.OPENAI_BASE_URL || getGlobalConfig().openAIBaseUrl,
    hasApiKey: !!process.env.OPENAI_API_KEY,
    hasMaximoApiKey: !!getGlobalConfig().maximoApiKey,
    hasAnthropicKey: !!getAnthropicApiKey(),
  });

  if (isEnvTruthy(process.env.MAXIMO_SYNTAX_USE_OPENAI)) {
    const baseUrl = process.env.OPENAI_BASE_URL || getGlobalConfig().openAIBaseUrl;
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && baseUrl?.includes("maximoai.co")) {
      console.log("[Usage] Found OPENAI_API_KEY with Maximo base URL");
      return true;
    }
  }

  // Check for configured Maximo API key in global config
  const globalConfig = getGlobalConfig();
  if (globalConfig.maximoApiKey) {
    console.log("[Usage] Found maximoApiKey in global config");
    return true;
  }

  // Check for Anthropic API key (could be Maximo key for OpenAI mode)
  if (getAnthropicApiKey()) {
    console.log("[Usage] Found Anthropic API key");
    return true;
  }

  console.log("[Usage] No Maximo API key found");
  return false;
}

/**
 * Get the API key to use for usage requests.
 * Prioritizes OPENAI_API_KEY for Option 1 users.
 */
function getUsageApiKey(): string | null {
  // For Option 1 users with OpenAI-compatible setup
  console.log("[Usage] getUsageApiKey:", {
    useOpenAI: isEnvTruthy(process.env.MAXIMO_SYNTAX_USE_OPENAI),
    baseUrl: process.env.OPENAI_BASE_URL || getGlobalConfig().openAIBaseUrl,
    hasKey: !!process.env.OPENAI_API_KEY,
    keyLength: process.env.OPENAI_API_KEY?.length,
    keyPrefix: process.env.OPENAI_API_KEY?.substring(0, 10),
  });

  if (isEnvTruthy(process.env.MAXIMO_SYNTAX_USE_OPENAI)) {
    const baseUrl = process.env.OPENAI_BASE_URL || getGlobalConfig().openAIBaseUrl;
    if (baseUrl?.includes("maximoai.co")) {
      console.log("[Usage] Returning OPENAI_API_KEY for usage endpoint");
      return process.env.OPENAI_API_KEY || null;
    }
  }

  // Check for Maximo API key in global config
  const globalConfig = getGlobalConfig();
  if (globalConfig.maximoApiKey) {
    console.log("[Usage] Returning maximoApiKey from global config");
    return globalConfig.maximoApiKey;
  }

  // Fall back to Anthropic API key
  const anthropicKey = getAnthropicApiKey();
  console.log("[Usage] Falling back to Anthropic API key:", !!anthropicKey);
  return anthropicKey;
}

/**
 * Check if usage endpoints should be available for the current auth method.
 * Returns true for:
 * - OAuth subscribers with inference scope (Option 2)
 * - Users with Maximo API key (Option 1)
 */
function canFetchUsage(): boolean {
  // Check for Option 2: OAuth tokens with Maximo inference scope
  const tokens = getMaximoAIOAuthTokens();
  const hasMaximoOAuth = tokens?.scopes && shouldUseMaximoAIAuth(tokens.scopes);

  // Check for Option 1: Any valid API key for Maximo
  const hasApiKey = hasMaximoApiKey();

  console.log("[Usage] canFetchUsage check:", {
    hasMaximoOAuth: !!hasMaximoOAuth,
    hasMaximoApiKey: hasApiKey,
    oauthScopes: tokens?.scopes,
  });

  // Option 2: Maximo OAuth users with inference scope
  if (hasMaximoOAuth) {
    return true;
  }

  // Option 1: API key users
  if (hasApiKey) {
    return true;
  }

  return false;
}

export type RateLimit = {
  utilization: number | null; // a percentage from 0 to 100
  resets_at: string | null; // ISO 8601 timestamp
};

export type ExtraUsage = {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
};

export type Utilization = {
  five_hour?: RateLimit | null;
  seven_day?: RateLimit | null;
  seven_day_oauth_apps?: RateLimit | null;
  seven_day_opus?: RateLimit | null;
  seven_day_sonnet?: RateLimit | null;
  extra_usage?: ExtraUsage | null;
  coding_plan?: {
    active: boolean;
    plan_id: string;
    tier: string;
    name: string;
    concurrency: number | null;
    models: string[];
    daily: Array<{
      day: string;
      requests: number;
      input_tokens: number | string;
      output_tokens: number | string;
      used_percent: number;
    }>;
  };
};

type MyTabulonPool = {
  usedPercent?: number;
  resetAt?: string | null;
} | null;

type MyTabulonCodingUsage = {
  active?: boolean;
  plan_id?: string;
  tier?: string;
  name?: string;
  concurrency?: number;
  models?: string[];
  window?: MyTabulonPool;
  weekly?: MyTabulonPool;
  daily?: Array<{
    day: string;
    requests: number;
    input_tokens: number | string;
    output_tokens: number | string;
    used_percent: number;
  }>;
  error?: { message?: string };
};

function getMyTabulonProviderConfig(): {
  baseUrl: string;
  apiKey: string;
} | null {
  const globalConfig = getGlobalConfig();
  const baseUrl = (
    process.env.OPENAI_BASE_URL ||
    globalConfig.openAIBaseUrl ||
    ""
  ).replace(/\/+$/, "");
  const apiKey = process.env.OPENAI_API_KEY || globalConfig.maximoApiKey || "";
  if (!baseUrl.includes("api.mytabulon.com") || !apiKey) {
    return null;
  }
  return { baseUrl, apiKey };
}

async function fetchMyTabulonCodingPlanUsage(): Promise<Utilization> {
  const provider = getMyTabulonProviderConfig();
  if (!provider) {
    return {};
  }
  const response = await fetch(`${provider.baseUrl}/coding-plan/usage`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      "User-Agent": getMaximoCodeUserAgent(),
    },
  });
  const data = (await response.json().catch(() => null)) as
    | MyTabulonCodingUsage
    | null;
  if (!response.ok || !data) {
    throw new Error(
      data?.error?.message ||
        `MyTabulon usage request failed (${response.status}).`
    );
  }
  const account = getGlobalConfig().mytabulonAccount;
  const toLimit = (pool: MyTabulonPool | undefined): RateLimit | null =>
    pool
      ? {
          utilization:
            typeof pool.usedPercent === "number" ? pool.usedPercent : null,
          resets_at: pool.resetAt || null,
        }
      : null;
  return {
    five_hour: toLimit(data.window),
    seven_day: toLimit(data.weekly),
    seven_day_oauth_apps: null,
    seven_day_opus: null,
    seven_day_sonnet: null,
    extra_usage: null,
    coding_plan: {
      active: Boolean(data.active),
      plan_id: String(
        data.plan_id || account?.codingPlanId || "coding_free_v1"
      ),
      tier: String(data.tier || account?.codingPlanTier || "free"),
      name: String(data.name || account?.codingPlanName || "Coding Free"),
      concurrency:
        typeof data.concurrency === "number" ? data.concurrency : null,
      models: Array.isArray(data.models) ? data.models : [],
      daily: Array.isArray(data.daily) ? data.daily : [],
    },
  };
}

// New detailed usage types
export type AllocationWindow = {
  limit: number;
  used: number;
  remaining: number;
  percentUsed: number;
  percentRemaining: number;
  resetAt: string;
};

export type Allocations = {
  daily: AllocationWindow;
  fiveHour: AllocationWindow;
  weekly: AllocationWindow;
};

export type SubscriptionInfo = {
  planType: string;
  isActive: boolean;
  status: string;
  nextPaymentDate: string | null;
  lastPaymentDate: string | null;
  displayAmount: string | null;
  currency: string;
};

export type BillingData = {
  walletBalance: number;
  totalSpent: number;
  totalDeposited: number;
  currency: string;
};

export type LifetimeStats = {
  totalRequests: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  freeAllocationUsed: number;
  paidFromBalance: number;
};

export type SourceBreakdown = {
  source: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  freeAllocationCovered: number;
};

export type DailyHistoryItem = {
  date: string;
  requests: number;
  allocatedUsd: number;
  paidUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export type FairUsageWindow = {
  window: string;
  percentRemaining: number;
  resetAt: string;
};

export type FairUsageStatus = {
  isWithinLimits: boolean;
  warning: boolean;
  message: string;
  nearLimitWindows: FairUsageWindow[];
};

export type DetailedUsageResponse = {
  success: boolean;
  data: {
    plan: string;
    subscription: SubscriptionInfo;
    allocations: Allocations | null;
    billing: BillingData;
    lifetimeStats: LifetimeStats;
    sourceBreakdown: SourceBreakdown[];
    dailyHistory: DailyHistoryItem[];
    fairUsageStatus: FairUsageStatus;
  };
};

export async function fetchUtilization(): Promise<Utilization | null> {
  if (getMyTabulonProviderConfig()) {
    return fetchMyTabulonCodingPlanUsage();
  }
  if (!canFetchUsage()) {
    return {};
  }

  // Get auth headers - supports both OAuth and API key auth
  const authResult = getAuthHeaders();
  if (authResult.error) {
    // For Option 1 users, try to use OPENAI_API_KEY directly
    const apiKey = getUsageApiKey();
    if (apiKey) {
      console.log("[Usage] Using API key for utilization endpoint");
      const response = await axios.get<Utilization>(
        `${getUsageApiBaseUrl()}/cli/oauth/usage`,
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": getMaximoCodeUserAgent(),
            "x-api-key": apiKey,
          },
          timeout: 5000, // 5 second timeout
        }
      );
      return response.data;
    }

    // Check if we have OAuth tokens despite getAuthHeaders() failing
    // This can happen when MAXIMO_SYNTAX_USE_OPENAI=1 is set but user is logged in via OAuth
    const tokens = getMaximoAIOAuthTokens();
    if (tokens?.accessToken && shouldUseMaximoAIAuth(tokens.scopes)) {
      // Skip API call if OAuth token is expired to avoid 401 errors
      if (isOAuthTokenExpired(tokens.expiresAt)) {
        console.log("[Usage] OAuth token expired");
        return null;
      }
      console.log("[Usage] Using OAuth token directly for utilization endpoint");
      const response = await axios.get<Utilization>(
        `${getUsageApiBaseUrl()}/cli/oauth/usage`,
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": getMaximoCodeUserAgent(),
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          timeout: 5000, // 5 second timeout
        }
      );
      return response.data;
    }

    throw new Error(`Auth error: ${authResult.error}`);
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": getMaximoCodeUserAgent(),
    ...authResult.headers,
  };

  const url = `${getUsageApiBaseUrl()}/cli/oauth/usage`;

  const response = await axios.get<Utilization>(url, {
    headers,
    timeout: 5000, // 5 second timeout
  });

  return response.data;
}

export async function fetchDetailedUsage(): Promise<DetailedUsageResponse | null> {
  if (getMyTabulonProviderConfig()) {
    return null;
  }
  if (!canFetchUsage()) {
    console.log("[Usage] canFetchUsage returned false - cannot fetch usage data");
    return null;
  }

  // Get auth headers - supports both OAuth and API key auth
  const authResult = getAuthHeaders();
  console.log("[Usage] fetchDetailedUsage authResult:", { error: authResult.error, hasHeaders: !!authResult.headers, headerKeys: authResult.headers ? Object.keys(authResult.headers) : [] });
  if (authResult.error) {
    // For Option 1 users, try to use OPENAI_API_KEY directly
    const apiKey = getUsageApiKey();
    console.log("[Usage] apiKey from getUsageApiKey():", !!apiKey, apiKey?.substring(0, 15));
    if (apiKey) {
      console.log("[Usage] Using API key for detailed-usage endpoint");
      try {
        const response = await axios.get<DetailedUsageResponse>(
          `${getUsageApiBaseUrl()}/cli/usage/detailed-usage`,
          {
            headers: {
              "Content-Type": "application/json",
              "User-Agent": getMaximoCodeUserAgent(),
              "x-api-key": apiKey,
            },
            timeout: 10000, // 10 second timeout for detailed data
          }
        );
        console.log("[Usage] Response received (API key):", response.data?.success);
        return response.data;
      } catch (err) {
        console.log("[Usage] API key request failed:", (err as any).response?.status, (err as any).response?.data);
        throw err;
      }
    }

    // Check if we have OAuth tokens despite getAuthHeaders() failing
    // This can happen when MAXIMO_SYNTAX_USE_OPENAI=1 is set but user is logged in via OAuth
    const tokens = getMaximoAIOAuthTokens();
    if (tokens?.accessToken && shouldUseMaximoAIAuth(tokens.scopes)) {
      // Skip API call if OAuth token is expired to avoid 401 errors
      if (isOAuthTokenExpired(tokens.expiresAt)) {
        console.log("[Usage] OAuth token expired");
        return null;
      }
      console.log("[Usage] Using OAuth token directly for detailed-usage endpoint");
      const response = await axios.get<DetailedUsageResponse>(
        `${getUsageApiBaseUrl()}/cli/usage/detailed-usage`,
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": getMaximoCodeUserAgent(),
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          timeout: 10000, // 10 second timeout for detailed data
        }
      );
      console.log("[Usage] Response received (OAuth):", response.data?.success);
      return response.data;
    }

    console.log("[Usage] Auth error:", authResult.error);
    throw new Error(`Auth error: ${authResult.error}`);
  }

  console.log("[Usage] Making request to /api/usage/detailed-usage with headers:", Object.keys(authResult.headers));

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": getMaximoCodeUserAgent(),
    ...authResult.headers,
  };

  const url = `${getUsageApiBaseUrl()}/cli/usage/detailed-usage`;

  try {
    const response = await axios.get<DetailedUsageResponse>(url, {
      headers,
      timeout: 10000, // 10 second timeout for detailed data
    });
    console.log("[Usage] Response received:", response.data?.success);
    return response.data;
  } catch (err) {
    console.log("[Usage] API error:", (err as any).response?.status, (err as any).response?.data);
    throw err;
  }
}
