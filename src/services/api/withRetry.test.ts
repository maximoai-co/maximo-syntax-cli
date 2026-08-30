import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import { expect, test } from 'bun:test'
import { isRetryableApiFailure, isTransientProviderRateLimit } from './withRetry.js'

function apiError(status: number, message: string, body?: object): APIError {
  return new APIError(
    status,
    body ?? { message },
    message,
    new Headers(),
  )
}

test('retries raw fetch failures from the OpenAI-compatible shim', () => {
  expect(isRetryableApiFailure(new TypeError('fetch failed'))).toBe(true)
  expect(isRetryableApiFailure(new APIConnectionError({ message: 'fetch failed' }))).toBe(true)
  expect(isRetryableApiFailure(new Error('fetch failed'))).toBe(true)
})

test('retries OpenAI-compatible 429 token-per-minute limits', () => {
  const message =
    'OpenAI-compatible API error 429: {"error":{"code":"token_limit_exceeded","message":"Tokens per minute limit (20000000) exceeded for your tier (model weight x10 applied). Reduce batch size or retry shortly.","type":"rate_limit_error"}}'
  expect(isRetryableApiFailure(new Error(message))).toBe(true)
  expect(isTransientProviderRateLimit(new Error(message))).toBe(true)

  const wrapped = apiError(429, message, {
    code: 'token_limit_exceeded',
    message: 'Tokens per minute limit (20000000) exceeded',
    type: 'rate_limit_error',
  })
  expect(isRetryableApiFailure(wrapped)).toBe(true)
  expect(isTransientProviderRateLimit(wrapped)).toBe(true)
})

test('retries OpenAI-compatible 5xx and connection timeouts', () => {
  expect(isRetryableApiFailure(new Error('OpenAI-compatible API error 503: overloaded'))).toBe(true)
  expect(isRetryableApiFailure(apiError(503, 'OpenAI-compatible API error 503: overloaded'))).toBe(true)
  expect(isRetryableApiFailure(new Error('OpenAI-compatible request timed out after 60000ms'))).toBe(true)
})

test('does not retry user cancels or permanent client errors', () => {
  expect(isRetryableApiFailure(new APIUserAbortError())).toBe(false)
  const abort = new Error('The operation was aborted')
  abort.name = 'AbortError'
  expect(isRetryableApiFailure(abort)).toBe(false)
  expect(isRetryableApiFailure(new Error('OpenAI-compatible API error 400: invalid_request'))).toBe(false)
  expect(isRetryableApiFailure(apiError(400, 'invalid_request'))).toBe(false)
})
