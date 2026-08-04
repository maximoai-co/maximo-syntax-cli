import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createOpenAIShimClient } from './openaiShim.js'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
}

const originalFetch = globalThis.fetch

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

function makeStreamChunks(chunks: unknown[]): string[] {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ]
}

beforeEach(() => {
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  process.env.OPENAI_API_KEY = 'test-key'
})

afterEach(() => {
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  globalThis.fetch = originalFetch
})

test('preserves usage from final OpenAI stream chunk with empty choices', async () => {
  globalThis.fetch = (async (_input, init) => {
    const url =
      typeof _input === 'string'
        ? _input
        : _input instanceof Request
          ? _input.url
          : _input.toString()
    expect(url).toBe('http://example.test/v1/chat/completions')

    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })

    const chunks = makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'hello world' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'fake-model',
        choices: [],
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          total_tokens: 168,
        },
      },
    ])

    return makeSseResponse(chunks)
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (
          params: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => Promise<unknown> & {
          withResponse: () => Promise<{ data: AsyncIterable<Record<string, unknown>> }>
        }
      }
    }
  }

  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  for await (const event of result.data) {
    events.push(event)
  }

  const usageEvent = events.find(
    event => event.type === 'message_delta' && typeof event.usage === 'object' && event.usage !== null,
  ) as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined

  expect(usageEvent).toBeDefined()
  expect(usageEvent?.usage?.input_tokens).toBe(123)
  expect(usageEvent?.usage?.output_tokens).toBe(45)
})

test('sends pasted base64 images as OpenAI-compatible data URLs', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'describe this' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
      },
    ])
    return Response.json({
      id: 'chatcmpl-image',
      model: 'fake-model',
      choices: [
        {
          message: { role: 'assistant', content: 'done' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 1 },
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<unknown>
      }
    }
  }
  await client.beta.messages.create({
    model: 'fake-model',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'aW1hZ2U=',
            },
          },
        ],
      },
    ],
    max_tokens: 64,
  })
})

test('buffers vision turns when an OpenAI-compatible image stream does not close', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(false)
    expect(body.stream_options).toBeUndefined()
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
    })
    return Response.json({
      id: 'chatcmpl-buffered-image',
      model: 'fake-vision-model',
      choices: [
        {
          message: { role: 'assistant', content: 'I can see the image.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>
      }
    }
  }

  const stream = await client.beta.messages.create({
    model: 'fake-vision-model',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'aW1hZ2U=',
            },
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: true,
  })

  const events: Array<Record<string, unknown>> = []
  for await (const event of stream) events.push(event)
  expect(events).toContainEqual({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'I can see the image.' },
  })
  expect(events.at(-2)).toMatchObject({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
  })
})

test('sends PDF document blocks as OpenAI-compatible file parts', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'summarize this' },
      {
        type: 'file',
        file: {
          filename: 'report.pdf',
          file_data: 'data:application/pdf;base64,cGRm',
        },
      },
    ])
    return Response.json({
      id: 'chatcmpl-pdf',
      model: 'fake-model',
      choices: [
        {
          message: { role: 'assistant', content: 'done' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 1 },
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<unknown>
      }
    }
  }

  await client.beta.messages.create({
    model: 'fake-model',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          {
            type: 'document',
            title: 'report.pdf',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: 'cGRm',
            },
          },
        ],
      },
    ],
    max_tokens: 64,
  })
})

test('forwards Read tool-result images as user vision input', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_read',
            type: 'function',
            function: {
              name: 'Read',
              arguments: '{"file_path":"/tmp/maximo-shot.jpg"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_read',
        content: '[Tool returned an image.]',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'The previous tool returned the following image(s):' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,aW1hZ2U=' },
          },
        ],
      },
    ])

    return Response.json({
      id: 'chatcmpl-read-image',
      model: 'fake-vision-model',
      choices: [
        {
          message: { role: 'assistant', content: 'I can see it.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<unknown>
      }
    }
  }

  await client.beta.messages.create({
    model: 'fake-vision-model',
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_read',
            name: 'Read',
            input: { file_path: '/tmp/maximo-shot.jpg' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_read',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: 'aW1hZ2U=',
                },
              },
            ],
          },
        ],
      },
    ],
    max_tokens: 64,
  })
})

test('aborts a stalled OpenAI-compatible request after the configured timeout', async () => {
  globalThis.fetch = (async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('request signal was not provided'))
        return
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })) as FetchType

  const client = createOpenAIShimClient({ timeout: 20 }) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<unknown>
      }
    }
  }

  await expect(
    client.beta.messages.create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
    }),
  ).rejects.toThrow('timed out')
})

test('aborts an OpenAI-compatible stream body after the configured timeout', async () => {
  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal
    const body = new ReadableStream({
      start(controller) {
        if (!signal) {
          controller.error(new Error('request signal was not provided'))
          return
        }
        signal.addEventListener('abort', () => controller.error(signal.reason), {
          once: true,
        })
      },
    })
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as FetchType

  const client = createOpenAIShimClient({ timeout: 20 }) as {
    beta: {
      messages: {
        create: (
          params: Record<string, unknown>,
        ) => Promise<unknown> & {
          withResponse: () => Promise<{ data: AsyncIterable<unknown> }>
        }
      }
    }
  }

  const result = await client.beta.messages
    .create({
      model: 'fake-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  await expect(
    (async () => {
      for await (const _event of result.data) {
        // The stream should abort before any provider event arrives.
      }
    })(),
  ).rejects.toThrow('timed out')
})

test('maps the selected effort to OpenAI-compatible reasoning_effort', async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.reasoning_effort).toBe('medium')
    return Response.json({
      id: 'chatcmpl-effort',
      model: 'maximo-atlas-preview',
      choices: [
        {
          message: { role: 'assistant', content: 'done' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 1 },
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<unknown>
      }
    }
  }
  await client.beta.messages.create({
    model: 'maximo-atlas-preview',
    messages: [{ role: 'user', content: 'think about this' }],
    max_tokens: 64,
    output_config: { effort: 'medium' },
  })
})

test('routes OpenRouter through its documented Chat Completions endpoint', async () => {
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
    expect(new Headers(init?.headers).get('HTTP-Referer')).toBe('https://maximoai.co')
    expect(new Headers(init?.headers).get('X-OpenRouter-Title')).toBe('Maximo Syntax')
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('openai/gpt-5.4')
    return Response.json({
      id: 'openrouter-completion',
      model: 'openai/gpt-5.4',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: { messages: { create: (params: Record<string, unknown>) => Promise<unknown> } }
  }
  await client.beta.messages.create({
    model: 'openai/gpt-5.4',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
  })
})

test('routes OpenCode Zen through its documented Chat Completions endpoint', async () => {
  process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/v1'
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe('https://opencode.ai/zen/v1/chat/completions')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
    return Response.json({
      id: 'opencode-completion',
      model: 'deepseek-v4-flash',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    })
  }) as FetchType

  const client = createOpenAIShimClient({}) as {
    beta: { messages: { create: (params: Record<string, unknown>) => Promise<unknown> } }
  }
  await client.beta.messages.create({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
  })
})
