// Smallest.ai Pulse streaming speech-to-text client for push-to-talk voice input.
//
// The client connects to the authenticated Maximo AI or MyTabulon backend proxy.
// The Smallest.ai credential remains server-side.

import type { ClientRequest, IncomingMessage } from "http";
import WebSocket from "ws";
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from "../utils/proxy.js";
import { getWebSocketTLSOptions } from "../utils/mtls.js";
import { jsonParse } from "../utils/slowOperations.js";
import { getUserAgent } from "../utils/http.js";
import { getMaximoAIBaseUrl, getMaximoApiKey } from "./api/maximoModels.js";

export const FINALIZE_TIMEOUTS_MS = {
  safety: 10_000,
  noData: 10_000,
};

export type VoiceStreamCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string, opts?: { fatal?: boolean }) => void;
  onClose: () => void;
  onReady: (connection: VoiceStreamConnection) => void;
};

export type FinalizeSource =
  | "post_closestream_endpoint"
  | "no_data_timeout"
  | "safety_timeout"
  | "ws_close"
  | "ws_already_closed";

export type VoiceStreamConnection = {
  send: (audioChunk: Buffer) => void;
  finalize: () => Promise<FinalizeSource>;
  close: () => void;
  isConnected: () => boolean;
};

const STT_PATH = "/ws/speech-to-text";
const MAX_KEYWORDS_LENGTH = 2_000;

const normalizeBaseUrl = (value: string) =>
  value.replace(/\/+$/, "").replace(/\/v1$/i, "");

const normalizeLanguage = (value: string | undefined) => {
  const language = String(value || "en").trim().toLowerCase();
  return /^[a-z][a-z_-]{0,19}$/.test(language) ? language : "en";
};

const buildParams = (
  language: string | undefined,
  keyterms: string[] | undefined
) => {
  const params = new URLSearchParams({
    language: normalizeLanguage(language),
    encoding: "linear16",
    sample_rate: "16000",
    word_timestamps: "false",
    endpointing: "true",
    eou_timeout_ms: "800",
    format: "true",
    itn_normalize: "true",
    finalize_on_words: "false",
  });
  const keywords = (keyterms || [])
    .map((term) => term.trim())
    .filter(Boolean)
    .join(",")
    .slice(0, MAX_KEYWORDS_LENGTH);
  if (keywords) params.set("keywords", keywords);
  return params;
};

const configuredBaseUrl = () =>
  normalizeBaseUrl(process.env.OPENAI_BASE_URL || getMaximoAIBaseUrl());

export function isVoiceStreamAvailable(): boolean {
  const baseUrl = configuredBaseUrl().toLowerCase();
  return Boolean(
    getMaximoApiKey() &&
      (baseUrl.includes("api.maximoai.co") || baseUrl.includes("api.mytabulon.com"))
  );
}

export async function connectVoiceStream(
  callbacks: VoiceStreamCallbacks,
  options?: { language?: string; keyterms?: string[] }
): Promise<VoiceStreamConnection | null> {
  const apiKey = getMaximoApiKey();
  if (!apiKey || !isVoiceStreamAvailable()) return null;

  const wsUrl = `${configuredBaseUrl()
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:")}${STT_PATH}?${buildParams(
    options?.language,
    options?.keyterms
  ).toString()}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": getUserAgent(),
  };
  const tlsOptions = getWebSocketTLSOptions();
  const wsOptions =
    typeof Bun !== "undefined"
      ? {
          headers,
          proxy: getWebSocketProxyUrl(wsUrl),
          tls: tlsOptions || undefined,
        }
      : { headers, agent: getWebSocketProxyAgent(wsUrl), ...tlsOptions };
  const ws = new WebSocket(wsUrl, wsOptions);

  let connected = false;
  let finalizing = false;
  let finalized = false;
  let lastInterim = "";
  let lastFinal = "";
  let resolveFinalize: ((source: FinalizeSource) => void) | null = null;

  const promoteInterim = () => {
    if (!lastInterim) return;
    const transcript = lastInterim;
    lastInterim = "";
    callbacks.onTranscript(transcript, true);
  };

  const connection: VoiceStreamConnection = {
    send(audioChunk) {
      if (connected && !finalized && ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from(audioChunk));
      }
    },
    finalize() {
      if (finalizing || finalized) return Promise.resolve("ws_already_closed");
      finalizing = true;
      return new Promise<FinalizeSource>((resolve) => {
        const safetyTimer = setTimeout(() => {
          promoteInterim();
          resolveFinalize = null;
          resolve("safety_timeout");
        }, FINALIZE_TIMEOUTS_MS.safety);
        const noDataTimer = setTimeout(() => {
          resolveFinalize?.("no_data_timeout");
        }, FINALIZE_TIMEOUTS_MS.noData);
        resolveFinalize = (source) => {
          clearTimeout(safetyTimer);
          clearTimeout(noDataTimer);
          resolveFinalize = null;
          promoteInterim();
          resolve(source);
        };
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          resolveFinalize("ws_already_closed");
          return;
        }
        setTimeout(() => {
          finalized = true;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('{"type":"close_stream"}');
          }
        }, 0);
      });
    },
    close() {
      finalized = true;
      connected = false;
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
    isConnected() {
      return connected && ws.readyState === WebSocket.OPEN;
    },
  };

  ws.on("open", () => {
    connected = true;
    callbacks.onReady(connection);
  });

  ws.on("message", (raw: Buffer | string) => {
    let message: Record<string, unknown>;
    try {
      message = jsonParse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (
      message.type === "error" ||
      message.status === "error" ||
      message.error
    ) {
      if (!finalizing) {
        callbacks.onError(
          String(message.message || message.description || message.error || "Speech transcription failed.")
        );
      }
      return;
    }
    if (typeof message.transcript !== "string") return;

    if (message.is_last === true) {
      if (!lastFinal.trim() && message.transcript.trim()) {
        callbacks.onTranscript(message.transcript, true);
      }
      lastInterim = "";
      resolveFinalize?.("post_closestream_endpoint");
      return;
    }

    if (finalized && message.is_final !== true) return;
    if (message.is_final === true) {
      lastInterim = "";
      lastFinal = message.transcript;
      callbacks.onTranscript(message.transcript, true);
    } else {
      lastInterim = message.transcript;
      callbacks.onTranscript(message.transcript, false);
    }
  });

  ws.on("close", (code, reason) => {
    connected = false;
    promoteInterim();
    resolveFinalize?.("ws_close");
    if (!finalizing && code !== 1000 && code !== 1005) {
      callbacks.onError(
        `Connection closed: code ${String(code)}${
          reason?.toString() ? ` — ${reason.toString()}` : ""
        }`,
        { fatal: code >= 4000 && code < 5000 }
      );
    }
    callbacks.onClose();
  });

  ws.on("unexpected-response", (request: ClientRequest, response: IncomingMessage) => {
    response.resume();
    request.destroy();
    callbacks.onError(
      `WebSocket upgrade rejected with HTTP ${String(response.statusCode || 0)}`,
      {
        fatal:
          (response.statusCode || 0) >= 400 &&
          (response.statusCode || 0) < 500,
      }
    );
  });

  ws.on("error", (error: Error) => {
    if (!finalizing) {
      callbacks.onError(`Voice stream connection error: ${error.message}`);
    }
  });

  return connection;
}
