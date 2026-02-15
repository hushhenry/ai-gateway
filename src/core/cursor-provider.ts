/**
 * Cursor ACP Provider for Vercel AI SDK
 * 
 * Wraps `cursor-agent` CLI and converts its stream-json NDJSON output
 * into Vercel AI SDK LanguageModelV1 format.
 * 
 * Tool handling (matching opencode-cursor's TOOL_LOOP_MODE=opencode):
 * - When caller provides tools: use default mode, intercept matching tool_calls
 * - When no tools: use ask mode (read-only, fast)
 * - Cursor's internal tools (read/write/bash) are handled by cursor-agent itself
 * 
 * Based on: https://github.com/Nomadcxx/opencode-cursor
 */
import { LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { spawn } from 'child_process';

// ─── Stream JSON Types ────────────────────────────────────────────────────────

interface StreamJsonTextContent { type: 'text'; text: string; }
interface StreamJsonThinkingContent { type: 'thinking'; thinking: string; }

interface StreamJsonAssistantEvent {
    type: 'assistant';
    message: { role: 'assistant'; content: Array<StreamJsonTextContent | StreamJsonThinkingContent>; };
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
    subtype?: string;
    call_id?: string;
    tool_call_id?: string;
    tool_call: Record<string, StreamJsonToolCallPayload>;
}

type StreamJsonEvent =
    | StreamJsonAssistantEvent
    | StreamJsonThinkingEvent
    | StreamJsonToolCallEvent
    | { type: 'result' | 'system' | 'user'; [key: string]: any };

// ─── Helpers ──────────────────────────────────────────────────────────────────

class DeltaTracker {
    private lastText = '';
    private lastThinking = '';
    nextText(v: string) { const d = v.startsWith(this.lastText) ? v.slice(this.lastText.length) : v; this.lastText = v; return d; }
    nextThinking(v: string) { const d = v.startsWith(this.lastThinking) ? v.slice(this.lastThinking.length) : v; this.lastThinking = v; return d; }
}

class LineBuffer {
    private buf = '';
    push(chunk: string): string[] {
        this.buf += chunk;
        const lines = this.buf.split('\n');
        this.buf = lines.pop() ?? '';
        return lines.filter(l => l.trim().length > 0);
    }
    flush(): string[] {
        const r = this.buf.trim(); this.buf = '';
        return r ? [r] : [];
    }
}

function parseEvent(line: string): StreamJsonEvent | null {
    try { const p = JSON.parse(line.trim()); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null; } catch { return null; }
}

function extractText(e: StreamJsonAssistantEvent): string {
    return e.message.content.filter((c): c is StreamJsonTextContent => c.type === 'text').map(c => c.text).join('');
}

function extractThinking(e: StreamJsonAssistantEvent | StreamJsonThinkingEvent): string {
    if (e.type === 'thinking') return (e as StreamJsonThinkingEvent).text ?? '';
    return (e as StreamJsonAssistantEvent).message.content.filter((c): c is StreamJsonThinkingContent => c.type === 'thinking').map(c => c.thinking).join('');
}

/**
 * Extract tool name from cursor-agent's tool_call event.
 * Handles formats like "readToolCall" → "read", "bashToolCall" → "bash"
 */
function inferToolName(event: StreamJsonToolCallEvent): string {
    const [key] = Object.keys(event.tool_call ?? {});
    if (!key) return '';
    if (key.endsWith('ToolCall')) {
        const base = key.slice(0, -'ToolCall'.length);
        return base.charAt(0).toLowerCase() + base.slice(1);
    }
    return key;
}

function extractToolArgs(event: StreamJsonToolCallEvent): Record<string, unknown> | undefined {
    const [key] = Object.keys(event.tool_call ?? {});
    if (!key) return undefined;
    const payload = event.tool_call[key];
    return payload?.args;
}

/**
 * Resolve a cursor tool name to a caller-provided tool name.
 * Matches exactly or via case-insensitive normalization.
 * Returns the caller's original tool name if matched, null otherwise.
 */
function resolveAllowedTool(cursorName: string, allowedNames: Set<string>): string | null {
    if (allowedNames.has(cursorName)) return cursorName;
    const norm = cursorName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const allowed of allowedNames) {
        if (allowed.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return allowed;
    }
    return null;
}

// ─── Cursor ACP Provider ──────────────────────────────────────────────────────

export class CursorProvider implements LanguageModelV1 {
    readonly specificationVersion = 'v1';
    readonly defaultObjectGenerationMode = undefined;
    readonly provider = 'cursor';

    constructor(
        readonly modelId: string,
        private cursorAgentPath: string = 'cursor-agent',
        private cwd: string = process.cwd(),
    ) {}

    static async discoverModels(agentPath?: string): Promise<Array<{ id: string; name: string }>> {
        const execPath = agentPath || process.env.CURSOR_AGENT_EXECUTABLE || 'cursor-agent';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        try {
            const { stdout } = await execFileAsync(execPath, ['models'], { timeout: 15000 });
            const models: Array<{ id: string; name: string }> = [];
            for (const line of stdout.split('\n')) {
                const match = line.match(/^(\S+)\s+-\s+(.+)/);
                if (match && match[1] && !line.includes('Available models') && !line.includes('Tip:'))
                    models.push({ id: match[1], name: match[2].trim() });
            }
            return models;
        } catch (e: any) {
            throw new Error(
                `cursor-agent not available: ${e.message}\n\n` +
                `Install: https://cursor.com/cn/docs/cli/overview\n` +
                `Then run: cursor-agent login`
            );
        }
    }

    /**
     * Build CLI args. When tools are provided, use default mode (full agent).
     * When no tools, use ask mode (read-only, fast).
     */
    private buildArgs(model: string, hasTools: boolean): string[] {
        const args = [
            '--print',
            '--output-format', 'stream-json',
            '--stream-partial-output',
            '--force',
            '--model', model,
        ];
        if (!hasTools) {
            args.push('--mode', 'ask');
        }
        return args;
    }

    /**
     * Build prompt from Vercel AI SDK messages.
     * When tools are present, inject tool definitions into the prompt
     * (matching opencode-cursor's buildPromptFromMessages).
     */
    private buildPrompt(options: any): string {
        const lines: string[] = [];

        // Inject tool definitions into prompt (opencode-cursor pattern)
        if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
            const toolDescs = options.tools.map((t: any) => {
                const name = t.name || 'unknown';
                const desc = t.description || '';
                const params = t.parameters ? JSON.stringify(t.parameters) : '{}';
                return `- ${name}: ${desc}\n  Parameters: ${params}`;
            }).join('\n');
            lines.push(
                `SYSTEM: You have access to the following tools. When you need to use one, ` +
                `respond with a tool_call in the standard OpenAI format.\n\nAvailable tools:\n${toolDescs}`
            );
        }

        // Convert messages
        if (Array.isArray(options.prompt)) {
            for (const msg of options.prompt) {
                if (msg.role === 'system' && typeof msg.content === 'string') {
                    lines.push(`SYSTEM: ${msg.content}`);
                } else if (msg.role === 'user') {
                    const text = typeof msg.content === 'string' ? msg.content
                        : Array.isArray(msg.content) ? msg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n') : '';
                    if (text) lines.push(`USER: ${text}`);
                } else if (msg.role === 'assistant') {
                    if (Array.isArray(msg.content)) {
                        const textParts: string[] = [];
                        const tcParts: string[] = [];
                        for (const part of msg.content) {
                            if (part.type === 'text') textParts.push(part.text);
                            if (part.type === 'tool-call') {
                                tcParts.push(`tool_call(id: ${part.toolCallId}, name: ${part.toolName}, args: ${JSON.stringify(part.args)})`);
                            }
                        }
                        const combined = [...textParts, ...tcParts].join('\n');
                        if (combined) lines.push(`ASSISTANT: ${combined}`);
                    }
                } else if (msg.role === 'tool') {
                    if (Array.isArray(msg.content)) {
                        for (const part of msg.content) {
                            if (part.type === 'tool-result') {
                                lines.push(`TOOL_RESULT (call_id: ${part.toolCallId}): ${JSON.stringify(part.result)}`);
                            }
                        }
                    }
                }
            }
        }

        // Add continuation signal after tool results
        if (lines.some(l => l.startsWith('TOOL_RESULT'))) {
            lines.push('The above tool calls have been executed. Continue your response based on these results.');
        }

        return lines.join('\n\n') || 'Hello';
    }

    /**
     * Extract allowed tool names from SDK tools parameter.
     */
    private getAllowedToolNames(options: any): Set<string> {
        const names = new Set<string>();
        if (options.tools && Array.isArray(options.tools)) {
            for (const t of options.tools) {
                if (t.name) names.add(t.name);
            }
        }
        return names;
    }

    async doGenerate(options: any): Promise<any> {
        const model = this.modelId;
        const allowedTools = this.getAllowedToolNames(options);
        const hasTools = allowedTools.size > 0;
        const prompt = this.buildPrompt(options);
        const args = this.buildArgs(model, hasTools);

        return new Promise((resolve, reject) => {
            const child = spawn(this.cursorAgentPath, args, {
                cwd: this.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            child.stdin.write(prompt);
            child.stdin.end();

            let stdout = '', stderr = '';
            child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

            const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('cursor-agent timed out')); }, 120000);

            child.on('close', (code) => {
                clearTimeout(timeout);
                if (code !== 0) { reject(new Error(`cursor-agent exited with code ${code}: ${stderr}`)); return; }

                let text = '';
                const toolCalls: any[] = [];
                const interceptedIds = new Set<string>();

                for (const line of stdout.trim().split('\n')) {
                    const event = parseEvent(line);
                    if (!event) continue;

                    if (event.type === 'assistant') {
                        const extracted = extractText(event as StreamJsonAssistantEvent);
                        if (extracted) text = extracted;
                    }

                    // Tool call interception (opencode mode)
                    if (event.type === 'tool_call' && hasTools) {
                        const tcEvent = event as StreamJsonToolCallEvent;
                        const cursorName = inferToolName(tcEvent);
                        const resolvedName = resolveAllowedTool(cursorName, allowedTools);

                        if (resolvedName) {
                            const callId = tcEvent.call_id || tcEvent.tool_call_id || `call_${Date.now()}`;
                            if (!interceptedIds.has(callId)) {
                                interceptedIds.add(callId);
                                const tcArgs = extractToolArgs(tcEvent);
                                toolCalls.push({
                                    toolCallType: 'function',
                                    toolCallId: callId,
                                    toolName: resolvedName,
                                    args: JSON.stringify(tcArgs ?? {}),
                                });
                            }
                        }
                        // else: cursor internal tool, let cursor-agent handle it
                    }
                }

                resolve({
                    text,
                    toolCalls,
                    finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
                    usage: { promptTokens: 0, completionTokens: 0 },
                    rawCall: { args },
                    rawResponse: {},
                });
            });

            child.on('error', (err) => { clearTimeout(timeout); reject(err); });
        });
    }

    async doStream(options: any): Promise<{
        stream: ReadableStream<LanguageModelV1StreamPart>;
        rawCall: any;
        rawResponse: any;
    }> {
        const model = this.modelId;
        const allowedTools = this.getAllowedToolNames(options);
        const hasTools = allowedTools.size > 0;
        const prompt = this.buildPrompt(options);
        const args = this.buildArgs(model, hasTools);

        const child = spawn(this.cursorAgentPath, args, {
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stdin.write(prompt);
        child.stdin.end();

        const tracker = new DeltaTracker();
        const lineBuffer = new LineBuffer();
        const interceptedIds = new Set<string>();
        let hasInterceptedToolCalls = false;

        const stream = new ReadableStream<LanguageModelV1StreamPart>({
            start(controller) {
                const timeout = setTimeout(() => { child.kill('SIGTERM'); controller.error(new Error('cursor-agent timed out')); }, 120000);

                child.stdout.on('data', (chunk: Buffer) => {
                    for (const line of lineBuffer.push(chunk.toString())) {
                        const event = parseEvent(line);
                        if (!event) continue;

                        // Text deltas
                        if (event.type === 'assistant') {
                            const ae = event as StreamJsonAssistantEvent;
                            if (ae.message.content.some(c => c.type === 'text')) {
                                const d = tracker.nextText(extractText(ae));
                                if (d) controller.enqueue({ type: 'text-delta', textDelta: d });
                            }
                            if (ae.message.content.some(c => c.type === 'thinking')) {
                                const d = tracker.nextThinking(extractThinking(ae));
                                if (d) controller.enqueue({ type: 'text-delta', textDelta: d });
                            }
                        }

                        if (event.type === 'thinking') {
                            const te = event as StreamJsonThinkingEvent;
                            if (te.text) {
                                const d = tracker.nextThinking(te.text);
                                if (d) controller.enqueue({ type: 'text-delta', textDelta: d });
                            }
                        }

                        // Tool call interception
                        if (event.type === 'tool_call' && hasTools) {
                            const tcEvent = event as StreamJsonToolCallEvent;
                            const cursorName = inferToolName(tcEvent);
                            const resolvedName = resolveAllowedTool(cursorName, allowedTools);

                            if (resolvedName) {
                                const callId = tcEvent.call_id || tcEvent.tool_call_id || `call_${Date.now()}`;
                                const tcArgs = extractToolArgs(tcEvent);

                                if (!interceptedIds.has(callId) && tcArgs !== undefined) {
                                    interceptedIds.add(callId);
                                    hasInterceptedToolCalls = true;
                                    controller.enqueue({
                                        type: 'tool-call',
                                        toolCallType: 'function',
                                        toolCallId: callId,
                                        toolName: resolvedName,
                                        args: JSON.stringify(tcArgs),
                                    });
                                }
                            }
                        }
                    }
                });

                child.stderr.on('data', () => {});

                child.on('close', () => {
                    clearTimeout(timeout);
                    for (const line of lineBuffer.flush()) {
                        const event = parseEvent(line);
                        if (event?.type === 'assistant') {
                            const d = tracker.nextText(extractText(event as StreamJsonAssistantEvent));
                            if (d) controller.enqueue({ type: 'text-delta', textDelta: d });
                        }
                    }
                    controller.enqueue({
                        type: 'finish',
                        finishReason: hasInterceptedToolCalls ? 'tool-calls' : 'stop',
                        usage: { promptTokens: 0, completionTokens: 0 },
                    });
                    controller.close();
                });

                child.on('error', (err) => { clearTimeout(timeout); controller.error(err); });
            }
        });

        return { stream, rawCall: { args }, rawResponse: {} };
    }
}
