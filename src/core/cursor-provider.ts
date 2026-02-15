/**
 * Cursor ACP Provider for Vercel AI SDK
 * 
 * Wraps `cursor-agent` CLI binary and converts its proprietary stream-json 
 * NDJSON output into Vercel AI SDK LanguageModelV1 format.
 * 
 * Based on: https://github.com/Nomadcxx/opencode-cursor
 */
import { LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { spawn, type ChildProcess } from 'child_process';

// ─── Stream JSON Types (matching cursor-agent output) ─────────────────────────

interface StreamJsonTextContent {
    type: 'text';
    text: string;
}

interface StreamJsonThinkingContent {
    type: 'thinking';
    thinking: string;
}

interface StreamJsonAssistantEvent {
    type: 'assistant';
    message: {
        role: 'assistant';
        content: Array<StreamJsonTextContent | StreamJsonThinkingContent>;
    };
}

interface StreamJsonThinkingEvent {
    type: 'thinking';
    subtype?: 'delta' | 'completed' | string;
    text?: string;
}

interface StreamJsonToolCallPayload {
    args?: Record<string, unknown>;
    result?: Record<string, unknown>;
}

interface StreamJsonToolCallEvent {
    type: 'tool_call';
    call_id?: string;
    tool_call_id?: string;
    tool_call: Record<string, StreamJsonToolCallPayload>;
}

interface StreamJsonResultEvent {
    type: 'result';
    subtype?: 'success' | 'error' | string;
    is_error?: boolean;
    error?: { message?: string };
}

type StreamJsonEvent =
    | StreamJsonAssistantEvent
    | StreamJsonThinkingEvent
    | StreamJsonToolCallEvent
    | StreamJsonResultEvent
    | { type: 'system' | 'user'; [key: string]: any };

// ─── Delta Tracker ────────────────────────────────────────────────────────────

class DeltaTracker {
    private lastText = '';
    private lastThinking = '';

    nextText(value: string): string {
        const delta = value.startsWith(this.lastText)
            ? value.slice(this.lastText.length)
            : value;
        this.lastText = value;
        return delta;
    }

    nextThinking(value: string): string {
        const delta = value.startsWith(this.lastThinking)
            ? value.slice(this.lastThinking.length)
            : value;
        this.lastThinking = value;
        return delta;
    }
}

// ─── Line Buffer ──────────────────────────────────────────────────────────────

class LineBuffer {
    private buffer = '';

    push(chunk: string): string[] {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        return lines.filter(l => l.trim().length > 0);
    }

    flush(): string[] {
        const remaining = this.buffer.trim();
        this.buffer = '';
        return remaining ? [remaining] : [];
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEvent(line: string): StreamJsonEvent | null {
    try {
        const parsed = JSON.parse(line.trim());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as StreamJsonEvent;
        }
    } catch {}
    return null;
}

function extractText(event: StreamJsonAssistantEvent): string {
    return event.message.content
        .filter((c): c is StreamJsonTextContent => c.type === 'text')
        .map(c => c.text)
        .join('');
}

function extractThinking(event: StreamJsonAssistantEvent | StreamJsonThinkingEvent): string {
    if (event.type === 'thinking') return (event as StreamJsonThinkingEvent).text ?? '';
    return (event as StreamJsonAssistantEvent).message.content
        .filter((c): c is StreamJsonThinkingContent => c.type === 'thinking')
        .map(c => c.thinking)
        .join('');
}

function inferToolName(event: StreamJsonToolCallEvent): string {
    const [key] = Object.keys(event.tool_call ?? {});
    if (!key) return 'tool';
    if (key.endsWith('ToolCall')) {
        const base = key.slice(0, -'ToolCall'.length);
        return base.charAt(0).toLowerCase() + base.slice(1);
    }
    return key;
}

// ─── Cursor ACP Provider (LanguageModelV1) ────────────────────────────────────

export class CursorProvider implements LanguageModelV1 {
    readonly specificationVersion = 'v1';
    readonly defaultObjectGenerationMode = undefined;
    readonly provider = 'cursor';

    constructor(
        readonly modelId: string,
        private cursorAgentPath: string = 'cursor-agent',
        private cwd: string = process.cwd(),
    ) {}

    /**
     * Discover available models by running `cursor-agent models`.
     * Follows the same approach as opencode-cursor's ModelDiscoveryService.
     * Throws with install instructions if cursor-agent is not available.
     */
    static async discoverModels(agentPath?: string): Promise<Array<{ id: string; name: string }>> {
        const execPath = agentPath || process.env.CURSOR_AGENT_EXECUTABLE || 'cursor-agent';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        try {
            const { stdout } = await execFileAsync(execPath, ['models'], { timeout: 15000 });
            const models: Array<{ id: string; name: string }> = [];
            for (const line of stdout.split('\n')) {
                // Parse lines like "gpt-5.2 - GPT-5.2" or "auto - Auto"
                const match = line.match(/^(\S+)\s+-\s+(.+)/);
                if (match && match[1] && !line.includes('Available models') && !line.includes('Tip:')) {
                    models.push({ id: match[1], name: match[2].trim() });
                }
            }
            return models;
        } catch (e: any) {
            throw new Error(
                `cursor-agent not available: ${e.message}\n\n` +
                `To use the Cursor provider, install cursor-agent and login:\n` +
                `  → https://cursor.com/cn/docs/cli/overview\n` +
                `  → Run: cursor-agent login`
            );
        }
    }

    private buildArgs(model: string): string[] {
        return [
            '--print',
            '--output-format', 'stream-json',
            '--stream-partial-output',
            '--force',      // skip workspace trust prompt
            '--mode', 'ask', // Q&A mode: read-only, no tool execution
            '--model', model,
        ];
    }

    private extractPrompt(options: any): string {
        // Vercel AI SDK passes prompt as array of messages
        if (Array.isArray(options.prompt)) {
            const lines: string[] = [];
            for (const msg of options.prompt) {
                if (msg.role === 'system' && typeof msg.content === 'string') {
                    lines.push(`system: ${msg.content}`);
                } else if (msg.role === 'user') {
                    if (typeof msg.content === 'string') {
                        lines.push(msg.content);
                    } else if (Array.isArray(msg.content)) {
                        for (const part of msg.content) {
                            if (part.type === 'text') lines.push(part.text);
                        }
                    }
                } else if (msg.role === 'assistant') {
                    if (Array.isArray(msg.content)) {
                        for (const part of msg.content) {
                            if (part.type === 'text') lines.push(`assistant: ${part.text}`);
                            if (part.type === 'tool-call') {
                                lines.push(`assistant called ${part.toolName}(${JSON.stringify(part.args)})`);
                            }
                        }
                    }
                } else if (msg.role === 'tool') {
                    if (Array.isArray(msg.content)) {
                        for (const part of msg.content) {
                            if (part.type === 'tool-result') {
                                lines.push(`tool result: ${JSON.stringify(part.result)}`);
                            }
                        }
                    }
                }
            }
            return lines.join('\n\n') || 'Hello';
        }
        return 'Hello';
    }

    async doGenerate(options: any): Promise<any> {
        const model = this.modelId;
        const prompt = this.extractPrompt(options);
        const args = this.buildArgs(model);

        return new Promise((resolve, reject) => {
            const child = spawn(this.cursorAgentPath, args, {
                cwd: this.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            child.stdin.write(prompt);
            child.stdin.end();

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            const timeout = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error('cursor-agent timed out after 120s'));
            }, 120000);

            child.on('close', (code) => {
                clearTimeout(timeout);
                if (code !== 0) {
                    reject(new Error(`cursor-agent exited with code ${code}: ${stderr}`));
                    return;
                }

                let text = '';
                const toolCalls: any[] = [];

                for (const line of stdout.trim().split('\n')) {
                    const event = parseEvent(line);
                    if (!event) continue;

                    if (event.type === 'assistant') {
                        const assistantEvent = event as StreamJsonAssistantEvent;
                        const extracted = extractText(assistantEvent);
                        if (extracted) text = extracted;
                    }

                    // Note: cursor-agent's internal tool_call events (read, write, bash, etc.)
                    // are agent-internal actions — cursor-agent executes them itself and returns
                    // the final text result. We do NOT expose them to the SDK as tool calls.
                }

                resolve({
                    text,
                    toolCalls: [],
                    finishReason: 'stop',
                    usage: { promptTokens: 0, completionTokens: 0 },
                    rawCall: { args },
                    rawResponse: {},
                });
            });

            child.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    async doStream(options: any): Promise<{
        stream: ReadableStream<LanguageModelV1StreamPart>;
        rawCall: any;
        rawResponse: any;
    }> {
        const model = this.modelId;
        const prompt = this.extractPrompt(options);
        const args = this.buildArgs(model);

        const child = spawn(this.cursorAgentPath, args, {
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stdin.write(prompt);
        child.stdin.end();

        const tracker = new DeltaTracker();
        const lineBuffer = new LineBuffer();

        const stream = new ReadableStream<LanguageModelV1StreamPart>({
            start(controller) {
                const timeout = setTimeout(() => {
                    child.kill('SIGTERM');
                    controller.error(new Error('cursor-agent timed out'));
                }, 120000);

                child.stdout.on('data', (chunk: Buffer) => {
                    const lines = lineBuffer.push(chunk.toString());
                    for (const line of lines) {
                        const event = parseEvent(line);
                        if (!event) continue;

                        // Text deltas
                        if (event.type === 'assistant') {
                            const ae = event as StreamJsonAssistantEvent;
                            const hasText = ae.message.content.some(c => c.type === 'text');
                            const hasThinking = ae.message.content.some(c => c.type === 'thinking');

                            if (hasText) {
                                const delta = tracker.nextText(extractText(ae));
                                if (delta) {
                                    controller.enqueue({ type: 'text-delta', textDelta: delta });
                                }
                            }
                            if (hasThinking) {
                                const delta = tracker.nextThinking(extractThinking(ae));
                                if (delta) {
                                    // Emit thinking as text for now (AI SDK doesn't have a standard thinking type)
                                    controller.enqueue({ type: 'text-delta', textDelta: delta });
                                }
                            }
                        }

                        // Standalone thinking events
                        if (event.type === 'thinking') {
                            const te = event as StreamJsonThinkingEvent;
                            if (te.text) {
                                const delta = tracker.nextThinking(te.text);
                                if (delta) {
                                    controller.enqueue({ type: 'text-delta', textDelta: delta });
                                }
                            }
                        }

                        // Note: cursor-agent's tool_call events are agent-internal
                        // (read, write, bash, etc.) — cursor-agent handles them itself.
                        // We only stream the text output to the SDK.
                    }
                });

                child.stderr.on('data', () => {
                    // Ignore stderr, cursor-agent logs there
                });

                child.on('close', (code) => {
                    clearTimeout(timeout);

                    // Flush remaining lines
                    for (const line of lineBuffer.flush()) {
                        const event = parseEvent(line);
                        if (!event) continue;
                        if (event.type === 'assistant') {
                            const delta = tracker.nextText(extractText(event as StreamJsonAssistantEvent));
                            if (delta) controller.enqueue({ type: 'text-delta', textDelta: delta });
                        }
                    }

                    controller.enqueue({
                        type: 'finish',
                        finishReason: 'stop',
                        usage: { promptTokens: 0, completionTokens: 0 },
                    });
                    controller.close();
                });

                child.on('error', (err) => {
                    clearTimeout(timeout);
                    controller.error(err);
                });
            }
        });

        return {
            stream,
            rawCall: { args },
            rawResponse: {},
        };
    }
}
