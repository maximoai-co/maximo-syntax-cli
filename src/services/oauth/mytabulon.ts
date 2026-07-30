import { openBrowser } from "../../utils/browser.js";
import { AuthCodeListener } from "./auth-code-listener.js";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./crypto.js";

const MYTABULON_OAUTH_BASE =
  process.env.MYTABULON_OAUTH_BASE_URL ||
  "https://api.mytabulon.com/api/syntax/oauth";
const MYTABULON_SUCCESS_URL =
  "https://platform.mytabulon.com/syntax/authorize?complete=1";

type AuthorizationStartResponse = {
  authorization_url?: string;
  error?: string;
  error_description?: string;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  api_base_url?: string;
  error?: string;
  error_description?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(
      data.error_description ||
        data.error ||
        `MyTabulon sign-in failed (${response.status}).`
    );
  }
  return data;
}

export class MyTabulonOAuthService {
  private listener: AuthCodeListener | null = null;

  async startOAuthFlow(
    authorizationUrlHandler: (url: string) => Promise<void>
  ): Promise<string> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    this.listener = new AuthCodeListener();
    const port = await this.listener.start();
    const redirectUri = `http://localhost:${port}/callback`;

    try {
      const startResponse = await fetch(`${MYTABULON_OAUTH_BASE}/authorize`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          redirect_uri: redirectUri,
          client_id: "maximo-syntax-cli",
        }),
      });
      const authorization = await readJson<AuthorizationStartResponse>(
        startResponse
      );
      if (!authorization.authorization_url) {
        throw new Error("MyTabulon did not return an authorization URL.");
      }

      const code = await this.listener.waitForAuthorization(state, async () => {
        await authorizationUrlHandler(authorization.authorization_url!);
        await openBrowser(authorization.authorization_url!);
      });

      const tokenResponse = await fetch(`${MYTABULON_OAUTH_BASE}/token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: "maximo-syntax-cli",
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }),
      });
      const token = await readJson<TokenResponse>(tokenResponse);
      if (!token.access_token) {
        throw new Error("MyTabulon did not return an API key.");
      }

      this.listener.handleSuccessRedirect([], (response) => {
        response.writeHead(302, { Location: MYTABULON_SUCCESS_URL });
        response.end();
      });
      return token.access_token;
    } catch (error) {
      this.listener.handleErrorRedirect();
      throw error;
    } finally {
      this.listener.close();
      this.listener = null;
    }
  }

  cleanup(): void {
    this.listener?.close();
    this.listener = null;
  }
}
