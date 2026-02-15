import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

interface Fixture {
  request: Record<string, unknown>;
  response?: Record<string, any>;
  chunks?: string[];
  timestamp: string;
}

function loadFixtures(): { name: string; fixture: Fixture }[] {
  let files: string[];
  try {
    files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => ({
    name: f.replace('.json', ''),
    fixture: JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as Fixture,
  }));
}

const fixtures = loadFixtures();

describe('tool-use response format validation (from fixtures)', () => {
  if (fixtures.length === 0) {
    it.skip('no fixtures found – run integration tests first', () => {});
    return;
  }

  for (const { name, fixture } of fixtures) {
    const isChatCompletions = name.startsWith('chat-completions');
    const isMessages = name.startsWith('messages');
    const isStreaming = name.endsWith('_streaming');
    const isNonStreaming = name.endsWith('_non-streaming');

    // ─── chat-completions non-streaming ────────────────────────────────
    if (isChatCompletions && isNonStreaming) {
      describe(`[chat-completions non-streaming] ${name}`, () => {
        it('has choices with tool_calls', () => {
          const resp = fixture.response!;
          expect(resp.choices).toBeDefined();
          expect(Array.isArray(resp.choices)).toBe(true);

          const msg = resp.choices[0].message;
          expect(msg.tool_calls).toBeDefined();
          expect(Array.isArray(msg.tool_calls)).toBe(true);
          expect(msg.tool_calls.length).toBeGreaterThanOrEqual(1);
        });

        it('function.arguments is a string (not object)', () => {
          const tc = fixture.response!.choices[0].message.tool_calls[0];
          expect(typeof tc.function.arguments).toBe('string');
          // Must be valid JSON
          const parsed = JSON.parse(tc.function.arguments);
          expect(typeof parsed).toBe('object');
        });

        it('tool call has correct name', () => {
          const tc = fixture.response!.choices[0].message.tool_calls[0];
          expect(tc.function.name).toBe('get_weather');
        });
      });
    }

    // ─── chat-completions streaming ────────────────────────────────────
    if (isChatCompletions && isStreaming) {
      describe(`[chat-completions streaming] ${name}`, () => {
        it('chunks contain tool_calls deltas', () => {
          expect(fixture.chunks).toBeDefined();
          expect(Array.isArray(fixture.chunks)).toBe(true);

          let foundToolCall = false;
          for (const line of fixture.chunks!) {
            if (line === '[DONE]') continue;
            const chunk = JSON.parse(line);
            if (chunk.choices?.[0]?.delta?.tool_calls) {
              foundToolCall = true;
            }
          }
          expect(foundToolCall).toBe(true);
        });

        it('accumulated tool_calls have string arguments', () => {
          let accName = '';
          let accArgs = '';

          for (const line of fixture.chunks!) {
            if (line === '[DONE]') continue;
            const chunk = JSON.parse(line);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.tool_calls) {
              const tc = delta.tool_calls[0];
              if (tc.function?.name) accName = tc.function.name;
              if (tc.function?.arguments) {
                expect(typeof tc.function.arguments).toBe('string');
                accArgs += tc.function.arguments;
              }
            }
          }

          expect(accName).toBe('get_weather');
          const parsed = JSON.parse(accArgs);
          expect(typeof parsed).toBe('object');
          expect(parsed).toHaveProperty('location');
        });
      });
    }

    // ─── messages non-streaming ────────────────────────────────────────
    if (isMessages && isNonStreaming) {
      describe(`[messages non-streaming] ${name}`, () => {
        it('has tool_use content block with object input', () => {
          const resp = fixture.response!;
          expect(resp.content).toBeDefined();
          expect(Array.isArray(resp.content)).toBe(true);

          const toolBlock = resp.content.find(
            (b: any) => b.type === 'tool_use',
          );
          expect(toolBlock).toBeDefined();
          expect(toolBlock.name).toBe('get_weather');
          expect(typeof toolBlock.input).toBe('object');
          expect(toolBlock.input).toHaveProperty('location');
        });

        it('stop_reason is tool_use', () => {
          expect(fixture.response!.stop_reason).toBe('tool_use');
        });
      });
    }

    // ─── messages streaming ────────────────────────────────────────────
    if (isMessages && isStreaming) {
      describe(`[messages streaming] ${name}`, () => {
        const events = (fixture.chunks || []).map((l) => JSON.parse(l));

        it('has content_block_start with tool_use', () => {
          const toolStart = events.find(
            (e: any) =>
              e.type === 'content_block_start' &&
              e.content_block?.type === 'tool_use',
          );
          expect(toolStart).toBeDefined();
          expect(toolStart.content_block.name).toBe('get_weather');
        });

        it('has content_block_delta with input_json_delta', () => {
          const jsonDeltas = events.filter(
            (e: any) =>
              e.type === 'content_block_delta' &&
              e.delta?.type === 'input_json_delta',
          );
          expect(jsonDeltas.length).toBeGreaterThanOrEqual(1);

          const fullJson = jsonDeltas
            .map((e: any) => e.delta.partial_json)
            .join('');
          const parsed = JSON.parse(fullJson);
          expect(parsed).toHaveProperty('location');
        });

        it('has content_block_stop', () => {
          const stops = events.filter(
            (e: any) => e.type === 'content_block_stop',
          );
          expect(stops.length).toBeGreaterThanOrEqual(1);
        });

        it('has message_delta with stop_reason tool_use', () => {
          const msgDelta = events.find(
            (e: any) => e.type === 'message_delta',
          );
          expect(msgDelta).toBeDefined();
          expect(msgDelta.delta.stop_reason).toBe('tool_use');
        });
      });
    }
  }
});
