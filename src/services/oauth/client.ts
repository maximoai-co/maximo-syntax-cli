// OAuth client for handling authentication flows with Maximo services
import axios from "axios";
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from "src/services/analytics/index.js";
import {
  ALL_OAUTH_SCOPES,
  CLAUDE_AI_INFERENCE_SCOPE,
  CLAUDE_AI_OAUTH_SCOPES,
  getOauthConfig,
} from "../../constants/oauth.js";
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getMaximoAIOAuthTokens,
  hasProfileScope,
  isMaximoAISubscriber,
  saveApiKey,
} from "../../utils/auth.js";
import type { AccountInfo } from "../../utils/config.js";
import { getGlobalConfig, saveGlobalConfig } from "../../utils/config.js";
import { logForDebugging } from "../../utils/debug.js";
import { getOauthProfileFromOauthToken } from "./getOauthProfile.js";
import type {
  BillingType,
  OAuthProfileResponse,
  OAuthTokenExchangeResponse,
  OAuthTokens,
  RateLimitTier,
  SubscriptionType,
  UserRolesResponse,
} from "./types.js";

/**
 * Check if the user has Maximo.ai authentication scope
 * @private Only call this if you're OAuth / auth related code!
 */
export function shouldUseMaximoAIAuth(scopes: string[] | undefined): boolean {
  return Boolean(scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE));
}

export function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(" ").filter(Boolean) ?? [];
}

// Maximo backend OAuth configuration
export const MAXIMO_OAUTH_CONFIG = {
  BASE_API_URL: "https://api.maximoai.co",
  AUTHORIZE_URL: "https://api.maximoai.co/syntax/auth/oauth/authorize",
  TOKEN_URL: "https://api.maximoai.co/syntax/auth/oauth/token",
  API_KEY_URL: "https://api.maximoai.co/syntax/auth/oauth/claude_cli/create_api_key",
  ROLES_URL: "https://api.maximoai.co/syntax/auth/oauth/claude_cli/roles",
  PROFILE_URL: "https://api.maximoai.co/syntax/auth/oauth/profile",
  MANUAL_REDIRECT_URL: "https://api.maximoai.co/syntax/auth/oauth/code/callback",
  CLIENT_ID: "maximo-cli-client",
  // Maximo-branded success page
  CLAUDEAI_SUCCESS_URL: "https://maximoai.co/syntax/oauth/success",
  CONSOLE_SUCCESS_URL: "https://maximoai.co/syntax/oauth/success",
};

export function buildAuthUrl({
  codeChallenge,
  state,
  port,
  isManual,
  loginWithMaximoAi,
  inferenceOnly,
  orgUUID,
  loginHint,
  loginMethod,
}: {
  codeChallenge: string;
  state: string;
  port: number;
  isManual: boolean;
  loginWithMaximoAi?: boolean;
  inferenceOnly?: boolean;
  orgUUID?: string;
  loginHint?: string;
  loginMethod?: string;
}): string {
  // Use Maximo backend for loginWithMaximoAi (Option 2), Anthropic for Console (Option 3)
  const authUrlBase = loginWithMaximoAi
    ? MAXIMO_OAUTH_CONFIG.AUTHORIZE_URL
    : getOauthConfig().CONSOLE_AUTHORIZE_URL;

  const authUrl = new URL(authUrlBase);
  authUrl.searchParams.append("code", "true");
  // Use Maximo client_id for Maximo OAuth, Anthropic for Console
  authUrl.searchParams.append(
    "client_id",
    loginWithMaximoAi
      ? MAXIMO_OAUTH_CONFIG.CLIENT_ID
      : getOauthConfig().CLIENT_ID
  );
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append(
    "redirect_uri",
    isManual
      ? loginWithMaximoAi
        ? MAXIMO_OAUTH_CONFIG.MANUAL_REDIRECT_URL
        : getOauthConfig().MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`
  );
  const scopesToUse = inferenceOnly
    ? [CLAUDE_AI_INFERENCE_SCOPE] // Long-lived inference-only tokens
    : ALL_OAUTH_SCOPES;
  authUrl.searchParams.append("scope", scopesToUse.join(" "));
  authUrl.searchParams.append("code_challenge", codeChallenge);
  authUrl.searchParams.append("code_challenge_method", "S256");
  authUrl.searchParams.append("state", state);

  // Add orgUUID as URL param if provided
  if (orgUUID) {
    authUrl.searchParams.append("orgUUID", orgUUID);
  }

  // Pre-populate email on the login form (standard OIDC parameter)
  if (loginHint) {
    authUrl.searchParams.append("login_hint", loginHint);
  }

  // Request a specific login method (e.g. 'sso', 'magic_link', 'google')
  if (loginMethod) {
    authUrl.searchParams.append("login_method", loginMethod);
  }

  return authUrl.toString();
}

export async function exchangeCodeForTokens(
  authorizationCode: string,
  state: string,
  codeVerifier: string,
  port: number,
  useManualRedirect: boolean = false,
  expiresIn?: number,
  loginWithMaximoAi?: boolean
): Promise<OAuthTokenExchangeResponse> {
  const config = loginWithMaximoAi ? MAXIMO_OAUTH_CONFIG : getOauthConfig();
  const requestBody: Record<string, string | number> = {
    grant_type: "authorization_code",
    code: authorizationCode,
    redirect_uri: useManualRedirect
      ? config.MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`,
    client_id: config.CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  };

  if (expiresIn !== undefined) {
    requestBody.expires_in = expiresIn;
  }

  const response = await axios.post(config.TOKEN_URL, requestBody, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  if (response.status !== 200) {
    throw new Error(
      response.status === 401
        ? "Authentication failed: Invalid authorization code"
        : `Token exchange failed (${response.status}): ${response.statusText}`
    );
  }
  logEvent("tengu_oauth_token_exchange_success", {});
  return response.data;
}

export async function refreshOAuthToken(
  refreshToken: string,
  { scopes: requestedScopes, loginWithMaximoAi }: { scopes?: string[]; loginWithMaximoAi?: boolean } = {}
): Promise<OAuthTokens> {
  const config = loginWithMaximoAi ? MAXIMO_OAUTH_CONFIG : getOauthConfig();
  const requestBody = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.CLIENT_ID,
    // Request specific scopes, defaulting to the full Maximo AI set.
    scope: (requestedScopes?.length
      ? requestedScopes
      : CLAUDE_AI_OAUTH_SCOPES
    ).join(" "),
  };

  try {
    const response = await axios.post(config.TOKEN_URL, requestBody, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    if (response.status !== 200) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = response.data as OAuthTokenExchangeResponse;
    const {
      access_token: accessToken,
      refresh_token: newRefreshToken = refreshToken,
      expires_in: expiresIn,
    } = data;

    const expiresAt = Date.now() + expiresIn * 1000;
    const scopes = parseScopes(data.scope);

    logEvent("tengu_oauth_token_refresh_success", {});

    const globalConfig = getGlobalConfig();
    const existing = getMaximoAIOAuthTokens();
    const haveProfileAlready =
      globalConfig.oauthAccount?.billingType !== undefined &&
      globalConfig.oauthAccount?.accountCreatedAt !== undefined &&
      globalConfig.oauthAccount?.subscriptionCreatedAt !== undefined &&
      existing?.subscriptionType != null &&
      existing?.rateLimitTier != null;

    const profileInfo = haveProfileAlready
      ? null
      : await fetchProfileInfo(accessToken, loginWithMaximoAi);

    // Update the stored properties if they have changed
    if (profileInfo && globalConfig.oauthAccount) {
      const updates: Partial<AccountInfo> = {};
      if (profileInfo.displayName !== undefined) {
        updates.displayName = profileInfo.displayName;
      }
      if (typeof profileInfo.hasExtraUsageEnabled === "boolean") {
        updates.hasExtraUsageEnabled = profileInfo.hasExtraUsageEnabled;
      }
      if (profileInfo.billingType !== null) {
        updates.billingType = profileInfo.billingType;
      }
      if (profileInfo.accountCreatedAt !== undefined) {
        updates.accountCreatedAt = profileInfo.accountCreatedAt;
      }
      if (profileInfo.subscriptionCreatedAt !== undefined) {
        updates.subscriptionCreatedAt = profileInfo.subscriptionCreatedAt;
      }
      if (Object.keys(updates).length > 0) {
        saveGlobalConfig((current) => ({
          ...current,
          oauthAccount: current.oauthAccount
            ? { ...current.oauthAccount, ...updates }
            : current.oauthAccount,
        }));
      }
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      scopes,
      subscriptionType:
        profileInfo?.subscriptionType ?? existing?.subscriptionType ?? null,
      rateLimitTier:
        profileInfo?.rateLimitTier ?? existing?.rateLimitTier ?? null,
      profile: profileInfo?.rawProfile,
      tokenAccount: data.account
        ? {
            uuid: data.account.uuid,
            emailAddress: data.account.email_address,
            organizationUuid: data.organization?.uuid,
          }
        : undefined,
    };
  } catch (error) {
    const responseBody =
      axios.isAxiosError(error) && error.response?.data
        ? JSON.stringify(error.response.data)
        : undefined;
    logEvent("tengu_oauth_token_refresh_failure", {
      error: (error as Error)
        .message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(responseBody && {
        responseBody:
          responseBody as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    });
    throw error;
  }
}

export async function fetchAndStoreUserRoles(
  accessToken: string,
  loginWithMaximoAi?: boolean
): Promise<void> {
  const config = loginWithMaximoAi ? MAXIMO_OAUTH_CONFIG : getOauthConfig();
  const response = await axios.get(config.ROLES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch user roles: ${response.statusText}`);
  }
  const data = response.data as UserRolesResponse;
  const globalConfig = getGlobalConfig();

  if (!globalConfig.oauthAccount) {
    throw new Error("OAuth account information not found in config");
  }

  saveGlobalConfig((current) => ({
    ...current,
    oauthAccount: current.oauthAccount
      ? {
          ...current.oauthAccount,
          organizationRole: data.organization_role,
          workspaceRole: data.workspace_role,
          organizationName: data.organization_name,
        }
      : current.oauthAccount,
  }));

  logEvent("tengu_oauth_roles_stored", {
    org_role:
      data.organization_role as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
}

export async function createAndStoreApiKey(
  accessToken: string,
  loginWithMaximoAi?: boolean
): Promise<string | null> {
  try {
    const config = loginWithMaximoAi ? MAXIMO_OAUTH_CONFIG : getOauthConfig();
    const response = await axios.post(config.API_KEY_URL, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const apiKey = response.data?.raw_key;
    if (apiKey) {
      await saveApiKey(apiKey);
      logEvent("tengu_oauth_api_key", {
        status:
          "success" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        statusCode: response.status,
      });
      return apiKey;
    }
    return null;
  } catch (error) {
    logEvent("tengu_oauth_api_key", {
      status:
        "failure" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error: (error instanceof Error
        ? error.message
        : String(
            error
          )) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    throw error;
  }
}

export function isOAuthTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) {
    return false;
  }

  const bufferTime = 5 * 60 * 1000;
  const now = Date.now();
  const expiresWithBuffer = now + bufferTime;
  return expiresWithBuffer >= expiresAt;
}

export async function fetchProfileInfo(accessToken: string, loginWithMaximoAi?: boolean): Promise<{
  subscriptionType: SubscriptionType | null;
  displayName?: string;
  rateLimitTier: RateLimitTier | null;
  hasExtraUsageEnabled: boolean | null;
  billingType: BillingType | null;
  accountCreatedAt?: string;
  subscriptionCreatedAt?: string;
  rawProfile?: OAuthProfileResponse;
}> {
  const config = loginWithMaximoAi ? MAXIMO_OAUTH_CONFIG : getOauthConfig();
  const profile = await getOauthProfileFromOauthToken(accessToken, loginWithMaximoAi);
  const orgType = profile?.organization?.organization_type;

  // Reuse the logic from fetchSubscriptionType
  let subscriptionType: SubscriptionType | null = null;
  switch (orgType) {
    case "pro":
      subscriptionType = "pro";
      break;
    case "prime":
      subscriptionType = "prime";
      break;
    case "plus":
      subscriptionType = "plus";
      break;
    default:
      // Return null for unknown organization types
      subscriptionType = null;
      break;
  }

  const result: {
    subscriptionType: SubscriptionType | null;
    displayName?: string;
    rateLimitTier: RateLimitTier | null;
    hasExtraUsageEnabled: boolean | null;
    billingType: BillingType | null;
    accountCreatedAt?: string;
    subscriptionCreatedAt?: string;
  } = {
    subscriptionType,
    rateLimitTier: profile?.organization?.rate_limit_tier ?? null,
    hasExtraUsageEnabled:
      profile?.organization?.has_extra_usage_enabled ?? null,
    billingType: profile?.organization?.billing_type ?? null,
  };

  if (profile?.account?.display_name) {
    result.displayName = profile.account.display_name;
  }

  if (profile?.account?.created_at) {
    result.accountCreatedAt = profile.account.created_at;
  }

  if (profile?.organization?.subscription_created_at) {
    result.subscriptionCreatedAt = profile.organization.subscription_created_at;
  }

  logEvent("tengu_oauth_profile_fetch_success", {});

  return { ...result, rawProfile: profile };
}

/**
 * Gets the organization UUID from the OAuth access token
 * @returns The organization UUID or null if not authenticated
 */
export async function getOrganizationUUID(): Promise<string | null> {
  // Check global config first to avoid unnecessary API call
  const globalConfig = getGlobalConfig();
  const orgUUID = globalConfig.oauthAccount?.organizationUuid;
  if (orgUUID) {
    return orgUUID;
  }

  // Fall back to fetching from profile (requires user:profile scope)
  const accessToken = getMaximoAIOAuthTokens()?.accessToken;
  if (accessToken === undefined || !hasProfileScope()) {
    return null;
  }
  const profile = await getOauthProfileFromOauthToken(accessToken);
  const profileOrgUUID = profile?.organization?.uuid;
  if (!profileOrgUUID) {
    return null;
  }
  return profileOrgUUID;
}

/**
 * Populate the OAuth account info if it has not already been cached in config.
 * @returns Whether or not the oauth account info was populated.
 */
export async function populateOAuthAccountInfoIfNeeded(): Promise<boolean> {
  // Check env vars first (synchronous, no network call needed).
  // SDK callers like Cowork can provide account info directly, which also
  // eliminates the race condition where early telemetry events lack account info.
  // NB: If/when adding additional SDK-relevant functionality requiring _other_ OAuth account properties,
  // please reach out to #proj-cowork so the team can add additional env var fallbacks.
  const envAccountUuid = process.env.CLAUDE_CODE_ACCOUNT_UUID;
  const envUserEmail = process.env.CLAUDE_CODE_USER_EMAIL;
  const envOrganizationUuid = process.env.CLAUDE_CODE_ORGANIZATION_UUID;
  const hasEnvVars = Boolean(
    envAccountUuid && envUserEmail && envOrganizationUuid
  );
  if (envAccountUuid && envUserEmail && envOrganizationUuid) {
    if (!getGlobalConfig().oauthAccount) {
      storeOAuthAccountInfo({
        accountUuid: envAccountUuid,
        emailAddress: envUserEmail,
        organizationUuid: envOrganizationUuid,
      });
    }
  }

  // Wait for any in-flight token refresh to complete first, since
  // refreshOAuthToken already fetches and stores profile info
  await checkAndRefreshOAuthTokenIfNeeded();

  const config = getGlobalConfig();
  if (
    (config.oauthAccount &&
      config.oauthAccount.billingType !== undefined &&
      config.oauthAccount.accountCreatedAt !== undefined &&
      config.oauthAccount.subscriptionCreatedAt !== undefined) ||
    !isMaximoAISubscriber() ||
    !hasProfileScope()
  ) {
    return false;
  }

  const tokens = getMaximoAIOAuthTokens();
  if (tokens?.accessToken) {
    const profile = await getOauthProfileFromOauthToken(tokens.accessToken);
    if (profile) {
      if (hasEnvVars) {
        logForDebugging(
          "OAuth profile fetch succeeded, overriding env var account info",
          { level: "info" }
        );
      }
      storeOAuthAccountInfo({
        accountUuid: profile.account.uuid,
        emailAddress: profile.account.email,
        organizationUuid: profile.organization.uuid,
        displayName: profile.account.display_name || undefined,
        hasExtraUsageEnabled:
          profile.organization.has_extra_usage_enabled ?? false,
        billingType: profile.organization.billing_type ?? undefined,
        accountCreatedAt: profile.account.created_at,
        subscriptionCreatedAt:
          profile.organization.subscription_created_at ?? undefined,
      });
      return true;
    }
  }
  return false;
}

export function storeOAuthAccountInfo({
  accountUuid,
  emailAddress,
  organizationUuid,
  displayName,
  hasExtraUsageEnabled,
  billingType,
  accountCreatedAt,
  subscriptionCreatedAt,
}: {
  accountUuid: string;
  emailAddress: string;
  organizationUuid: string | undefined;
  displayName?: string;
  hasExtraUsageEnabled?: boolean;
  billingType?: BillingType;
  accountCreatedAt?: string;
  subscriptionCreatedAt?: string;
}): void {
  const accountInfo: AccountInfo = {
    accountUuid,
    emailAddress,
    organizationUuid,
    hasExtraUsageEnabled,
    billingType,
    accountCreatedAt,
    subscriptionCreatedAt,
  };
  if (displayName) {
    accountInfo.displayName = displayName;
  }
  saveGlobalConfig((current) => {
    // For oauthAccount we need to compare content since it's an object
    if (
      current.oauthAccount?.accountUuid === accountInfo.accountUuid &&
      current.oauthAccount?.emailAddress === accountInfo.emailAddress &&
      current.oauthAccount?.organizationUuid === accountInfo.organizationUuid &&
      current.oauthAccount?.displayName === accountInfo.displayName &&
      current.oauthAccount?.hasExtraUsageEnabled ===
        accountInfo.hasExtraUsageEnabled &&
      current.oauthAccount?.billingType === accountInfo.billingType &&
      current.oauthAccount?.accountCreatedAt === accountInfo.accountCreatedAt &&
      current.oauthAccount?.subscriptionCreatedAt ===
        accountInfo.subscriptionCreatedAt
    ) {
      return current;
    }
    return { ...current, oauthAccount: accountInfo };
  });
}
