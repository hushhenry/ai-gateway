import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8192';

// Models to test - configure here
const CHAT_COMPLETIONS_MODELS = [
  // 'gemini-cli/gemini-3-flash-preview',  // uncomment when quota available
  'anthropic-token/claude-haiku-4-5-20251001',
];

const MESSAGES_MODELS = [
  // 'gemini-cli/gemini-3-flash-preview',  // uncomment when quota available
  'anthropic-token/claude-haiku-4-5-20251001',
];

const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// OpenAI-format tool definition
const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather in a given location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
        },
        required: ['location'],
      },
    },
  },
];

// Anthropic-format tool definition
const ANTHROPIC_TOOLS = [
  {
    name: 'get_weather',
    description: 'Get the current weather in a given location',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    },
  },
];

function modelSlug(model: string): string {
  return model.replace(/\//g, '_');
}

function saveFixture(name: string, data: Record<string, unknown>): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(
    join(FIXTURES_DIR, `${name}.json`),
    JSON.stringify(data, null, 2),
  );
}

/**
 * Parse SSE text into an array of data-line strings.
 * Handles both `event: ...\ndata: ...` and bare `data: ...` formats.
 */
function parseSSE(raw: string): string[] {
  const lines: string[] = [];
  // Split on double-newline to get SSE blocks
  const blocks = raw.split(/\n\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('data: ')) {
        lines.push(line.slice(6));
      }
    }
  }
  return lines;
}

let gatewayAvailable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    gatewayAvailable = res.ok;
  } catch {
    gatewayAvailable = false;
  }
});

// ─── /v1/chat/completions ────────────────────────────────────────────────────

describe('/v1/chat/completions', () => {
  for (const model of CHAT_COMPLETIONS_MODELS) {
    describe(`model: ${model}`, () => {
      it('non-streaming: returns tool_calls', async () => {
        if (!gatewayAvailable) return; // skip silently

        const requestBody = {
          model,
          stream: false,
          messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
          tools: OPENAI_TOOLS,
        };

        const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        const response = await res.json();
        expect(res.ok, `Gateway returned ${res.status}: ${JSON.stringify(response)}`).toBe(true);

        // Save fixture
        saveFixture(`chat-completions_${modelSlug(model)}_non-streaming`, {
          request: requestBody,
          response,
          timestamp: new Date().toISOString(),
        });

        // Assertions
        const message = response.choices?.[0]?.message;
        expect(message).toBeDefined();
        expect(message.tool_calls).toBeDefined();
        expect(Array.isArray(message.tool_calls)).toBe(true);
        expect(message.tool_calls.length).toBeGreaterThanOrEqual(1);

        const firstTC = message.tool_calls[0];
        expect(firstTC.function.name).toBe('get_weather');
        expect(typeof firstTC.function.arguments).toBe('string');

        const args = JSON.parse(firstTC.function.arguments);
        expect(args).toHaveProperty('location');
      });

      it('streaming: returns tool_calls via SSE deltas', async () => {
        if (!gatewayAvailable) return;

        const requestBody = {
          model,
          stream: true,
          messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
          tools: OPENAI_TOOLS,
        };

        const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        expect(res.ok, `Gateway returned ${res.status}`).toBe(true);
        const raw = await res.text();
        const dataLines = parseSSE(raw);

        // Save fixture
        saveFixture(`chat-completions_${modelSlug(model)}_streaming`, {
          request: requestBody,
          chunks: dataLines,
          timestamp: new Date().toISOString(),
        });

        // At least one chunk should have tool_calls in delta
        let foundToolCall = false;
        let accName = '';
        let accArgs = '';

        for (const line of dataLines) {
          if (line === '[DONE]') continue;
          const chunk = JSON.parse(line);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.tool_calls) {
            foundToolCall = true;
            const tc = delta.tool_calls[0];
            if (tc.function?.name) accName = tc.function.name;
            if (tc.function?.arguments) accArgs += tc.function.arguments;
          }
        }

        expect(foundToolCall).toBe(true);
        expect(accName).toBe('get_weather');

        const args = JSON.parse(accArgs);
        expect(args).toHaveProperty('location');
      });
    });
  }
});

// ─── /v1/messages ────────────────────────────────────────────────────────────

describe('/v1/messages', () => {
  for (const model of MESSAGES_MODELS) {
    describe(`model: ${model}`, () => {
      it('non-streaming: returns tool_use content block', async () => {
        if (!gatewayAvailable) return;

        const requestBody = {
          model,
          stream: false,
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
          tools: ANTHROPIC_TOOLS,
        };

        const res = await fetch(`${GATEWAY_URL}/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        const response = await res.json();
        expect(res.ok, `Gateway returned ${res.status}: ${JSON.stringify(response)}`).toBe(true);

        saveFixture(`messages_${modelSlug(model)}_non-streaming`, {
          request: requestBody,
          response,
          timestamp: new Date().toISOString(),
        });

        // Find tool_use block
        const toolBlock = response.content?.find(
          (b: any) => b.type === 'tool_use',
        );
        expect(toolBlock).toBeDefined();
        expect(toolBlock.name).toBe('get_weather');
        expect(typeof toolBlock.input).toBe('object');
        expect(toolBlock.input).toHaveProperty('location');
        expect(response.stop_reason).toBe('tool_use');
      });

      it('streaming: returns tool_use SSE events', async () => {
        if (!gatewayAvailable) return;

        const requestBody = {
          model,
          stream: true,
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
          tools: ANTHROPIC_TOOLS,
        };

        const res = await fetch(`${GATEWAY_URL}/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        expect(res.ok, `Gateway returned ${res.status}`).toBe(true);
        const raw = await res.text();
        const dataLines = parseSSE(raw);

        saveFixture(`messages_${modelSlug(model)}_streaming`, {
          request: requestBody,
          chunks: dataLines,
          timestamp: new Date().toISOString(),
        });

        const events = dataLines.map((l) => JSON.parse(l));

        // Verify content_block_start with tool_use
        const toolStart = events.find(
          (e: any) =>
            e.type === 'content_block_start' &&
            e.content_block?.type === 'tool_use',
        );
        expect(toolStart).toBeDefined();
        expect(toolStart.content_block.name).toBe('get_weather');

        // Verify input_json_delta
        const jsonDeltas = events.filter(
          (e: any) =>
            e.type === 'content_block_delta' &&
            e.delta?.type === 'input_json_delta',
        );
        expect(jsonDeltas.length).toBeGreaterThanOrEqual(1);

        // Accumulate partial JSON and parse
        const fullJson = jsonDeltas
          .map((e: any) => e.delta.partial_json)
          .join('');
        const args = JSON.parse(fullJson);
        expect(args).toHaveProperty('location');

        // Verify message_delta with stop_reason
        const msgDelta = events.find((e: any) => e.type === 'message_delta');
        expect(msgDelta).toBeDefined();
        expect(msgDelta.delta.stop_reason).toBe('tool_use');
      });
    });
  }
});
