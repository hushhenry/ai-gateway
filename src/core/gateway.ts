import { Hono } from 'hono';
import { streamText, generateText } from 'ai';
import { stream } from 'hono/streaming';
import { jsonSchema } from 'ai';
import { getProvider } from './providers.js';
import { loadAuth } from './auth.js';

/**
 * Convert Anthropic API messages to Vercel AI SDK CoreMessage format.
 * Key differences:
 * - Anthropic: tool_result blocks inside role:"user" messages
 * - SDK: role:"tool" messages with toolCallId + result
 * - Anthropic: tool_use blocks inside role:"assistant" messages
 * - SDK: role:"assistant" with toolCall content parts
 */
function convertAnthropicMessages(messages: any[]): any[] {
    const result: any[] = [];

    for (const msg of messages) {
        if (msg.role === 'user') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'user', content: msg.content });
                continue;
            }

            // Split content into regular content and tool_result blocks
            const userParts: any[] = [];
            const toolResults: any[] = [];

            for (const block of msg.content) {
                if (block.type === 'tool_result') {
                    toolResults.push(block);
                } else if (block.type === 'text') {
                    userParts.push({ type: 'text', text: block.text });
                } else if (block.type === 'image') {
                    userParts.push({
                        type: 'image',
                        image: block.source?.data || '',
                        mimeType: block.source?.media_type,
                    });
                }
            }

            // Emit tool results as role:"tool" messages
            for (const tr of toolResults) {
                let textContent = '';
                if (typeof tr.content === 'string') {
                    textContent = tr.content;
                } else if (Array.isArray(tr.content)) {
                    textContent = tr.content
                        .filter((b: any) => b.type === 'text')
                        .map((b: any) => b.text)
                        .join('\n');
                }
                result.push({
                    role: 'tool',
                    content: [{ type: 'tool-result', toolCallId: tr.tool_use_id, result: textContent }],
                });
            }

            // Emit remaining user content
            if (userParts.length > 0) {
                result.push({ role: 'user', content: userParts });
            }
        } else if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'assistant', content: msg.content });
                continue;
            }

            const parts: any[] = [];
            for (const block of msg.content) {
                if (block.type === 'text') {
                    parts.push({ type: 'text', text: block.text });
                } else if (block.type === 'tool_use') {
                    parts.push({
                        type: 'tool-call',
                        toolCallId: block.id,
                        toolName: block.name,
                        args: block.input,
                    });
                }
                // thinking blocks are skipped (SDK doesn't have a standard format for them)
            }
            if (parts.length > 0) {
                result.push({ role: 'assistant', content: parts });
            }
        }
    }

    return result;
}

export class AiGateway {
    private app: Hono;
    private configPath?: string;

    constructor(options: { configPath?: string } = {}) {
        this.configPath = options.configPath;
        this.app = new Hono();
        this.setupRoutes();
    }

    private setupRoutes() {
        this.app.get('/v1/models', async (c) => {
            const auth = loadAuth(this.configPath);
            const models: any[] = [];
            
            for (const providerId in auth) {
                const creds = auth[providerId];
                const enabledModels = creds.enabledModels || [];
                
                for (const modelId of enabledModels) {
                    models.push({
                        id: `${providerId}/${modelId}`,
                        object: 'model',
                        created: Date.now(),
                        owned_by: 'ai-gateway'
                    });
                }
            }
            
            return c.json({ object: 'list', data: models });
        });

        this.app.post('/v1/chat/completions', async (c) => {
            const body = await c.req.json();
            const modelId = body.model;
            const isStreaming = body.stream === true;
            
            try {
                const provider = await getProvider(modelId, this.configPath);
                
                const options: any = {
                    model: provider,
                    messages: body.messages,
                    temperature: body.temperature,
                    topP: body.top_p,
                    maxTokens: body.max_tokens,
                };

                // Forward tools in OpenAI format → Vercel AI SDK format
                if (body.tools) {
                    options.tools = body.tools.reduce((acc: any, tool: any) => {
                        const fn = tool.function || tool;
                        acc[fn.name] = {
                            description: fn.description,
                            parameters: jsonSchema(fn.parameters),
                        };
                        return acc;
                    }, {});

                    // Forward tool_choice
                    if (body.tool_choice) {
                        if (body.tool_choice === 'auto') {
                            options.toolChoice = { type: 'auto' };
                        } else if (body.tool_choice === 'required') {
                            options.toolChoice = { type: 'required' };
                        } else if (body.tool_choice === 'none') {
                            options.toolChoice = { type: 'none' };
                        } else if (typeof body.tool_choice === 'object' && body.tool_choice.function?.name) {
                            options.toolChoice = { type: 'tool', toolName: body.tool_choice.function.name };
                        }
                    }
                }

                if (isStreaming) {
                    const result = await streamText(options);
                    const streamId = `chatcmpl-${Date.now()}`;

                    c.header('Content-Type', 'text/event-stream');
                    c.header('Cache-Control', 'no-cache');
                    c.header('Connection', 'keep-alive');

                    return stream(c, async (stream) => {
                        for await (const part of result.fullStream) {
                            if (part.type === 'text-delta') {
                                await stream.write(`data: ${JSON.stringify({
                                    id: streamId,
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    model: modelId,
                                    choices: [{
                                        index: 0,
                                        delta: { content: part.textDelta },
                                        finish_reason: null
                                    }]
                                })}\n\n`);
                            } else if (part.type === 'tool-call') {
                                await stream.write(`data: ${JSON.stringify({
                                    id: streamId,
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    model: modelId,
                                    choices: [{
                                        index: 0,
                                        delta: {
                                            tool_calls: [{
                                                index: 0,
                                                id: part.toolCallId,
                                                type: 'function',
                                                function: {
                                                    name: part.toolName,
                                                    arguments: typeof part.args === 'string' ? part.args : JSON.stringify(part.args)
                                                }
                                            }]
                                        },
                                        finish_reason: null
                                    }]
                                })}\n\n`);
                            } else if (part.type === 'finish') {
                                await stream.write(`data: ${JSON.stringify({
                                    id: streamId,
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    model: modelId,
                                    choices: [{
                                        index: 0,
                                        delta: {},
                                        finish_reason: part.finishReason
                                    }]
                                })}\n\n`);
                            }
                        }
                        await stream.write('data: [DONE]\n\n');
                    });
                } else {
                    const result = await generateText(options);

                    return c.json({
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: result.text,
                                    tool_calls: result.toolCalls?.map(tc => ({
                                        id: tc.toolCallId,
                                        type: 'function',
                                        function: {
                                            name: tc.toolName,
                                            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
                                        }
                                    }))
                                },
                                finish_reason: result.finishReason,
                            },
                        ],
                        usage: {
                            prompt_tokens: result.usage.promptTokens,
                            completion_tokens: result.usage.completionTokens,
                            total_tokens: result.usage.promptTokens + result.usage.completionTokens,
                        },
                    });
                }
            } catch (error: any) {
                return c.json({ error: { message: error.message } }, 500);
            }
        });

        this.app.post('/v1/messages', async (c) => {
            const body = await c.req.json();
            const modelId = body.model;
            const isStreaming = body.stream === true;
            
            try {
                const provider = await getProvider(modelId, this.configPath);
                
                // Convert Anthropic messages to Vercel AI SDK CoreMessage format
                const messages = convertAnthropicMessages(body.messages);

                // Normalize system prompt: Anthropic can send string or array of content blocks
                let systemPrompt: string | undefined;
                if (body.system) {
                    if (typeof body.system === 'string') {
                        systemPrompt = body.system;
                    } else if (Array.isArray(body.system)) {
                        systemPrompt = body.system
                            .filter((b: any) => b.type === 'text')
                            .map((b: any) => b.text)
                            .join('\n');
                    }
                }

                const options: any = {
                    model: provider,
                    messages,
                    system: systemPrompt,
                    temperature: body.temperature,
                    topP: body.top_p,
                    maxTokens: body.max_tokens,
                };

                // Support Anthropic tools → Vercel AI SDK format
                if (body.tools) {
                    options.tools = body.tools.reduce((acc: any, tool: any) => {
                        acc[tool.name] = {
                            description: tool.description,
                            parameters: jsonSchema(tool.input_schema),
                        };
                        return acc;
                    }, {});

                    // Forward tool_choice (Anthropic format)
                    if (body.tool_choice) {
                        if (body.tool_choice.type === 'auto') {
                            options.toolChoice = { type: 'auto' };
                        } else if (body.tool_choice.type === 'any') {
                            options.toolChoice = { type: 'required' };
                        } else if (body.tool_choice.type === 'tool' && body.tool_choice.name) {
                            options.toolChoice = { type: 'tool', toolName: body.tool_choice.name };
                        }
                    }
                }

                if (isStreaming) {
                    const result = await streamText(options);
                    const msgId = `msg-${Date.now()}`;

                    c.header('Content-Type', 'text/event-stream');
                    c.header('Cache-Control', 'no-cache');
                    c.header('Connection', 'keep-alive');

                    return stream(c, async (stream) => {
                        await stream.write(`event: message_start\ndata: ${JSON.stringify({
                            type: 'message_start',
                            message: {
                                id: msgId,
                                type: 'message',
                                role: 'assistant',
                                model: modelId,
                                content: [],
                                stop_reason: null,
                                stop_sequence: null,
                                usage: { input_tokens: 0, output_tokens: 0 }
                            }
                        })}\n\n`);

                        let currentBlockIndex = -1;
                        let textBlockOpen = false;
                        let hasToolCalls = false;

                        for await (const part of result.fullStream) {
                            if (part.type === 'text-delta') {
                                if (!textBlockOpen) {
                                    currentBlockIndex++;
                                    textBlockOpen = true;
                                    await stream.write(`event: content_block_start\ndata: ${JSON.stringify({
                                        type: 'content_block_start',
                                        index: currentBlockIndex,
                                        content_block: { type: 'text', text: '' }
                                    })}\n\n`);
                                }
                                await stream.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                    type: 'content_block_delta',
                                    index: currentBlockIndex,
                                    delta: { type: 'text_delta', text: part.textDelta }
                                })}\n\n`);
                            } else if (part.type === 'tool-call') {
                                // Close text block if open
                                if (textBlockOpen) {
                                    await stream.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                        type: 'content_block_stop',
                                        index: currentBlockIndex
                                    })}\n\n`);
                                    textBlockOpen = false;
                                }

                                hasToolCalls = true;
                                currentBlockIndex++;
                                await stream.write(`event: content_block_start\ndata: ${JSON.stringify({
                                    type: 'content_block_start',
                                    index: currentBlockIndex,
                                    content_block: { 
                                        type: 'tool_use', 
                                        id: part.toolCallId,
                                        name: part.toolName,
                                        input: {} 
                                    }
                                })}\n\n`);

                                const argsJson = typeof part.args === 'string' ? part.args : JSON.stringify(part.args);
                                await stream.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                    type: 'content_block_delta',
                                    index: currentBlockIndex,
                                    delta: { 
                                        type: 'input_json_delta', 
                                        partial_json: argsJson
                                    }
                                })}\n\n`);

                                await stream.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                    type: 'content_block_stop',
                                    index: currentBlockIndex
                                })}\n\n`);
                            }
                        }

                        // Close text block if still open
                        if (textBlockOpen) {
                            await stream.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                type: 'content_block_stop',
                                index: currentBlockIndex
                            })}\n\n`);
                        }

                        const stopReason = hasToolCalls ? 'tool_use' : 'end_turn';

                        await stream.write(`event: message_delta\ndata: ${JSON.stringify({
                            type: 'message_delta',
                            delta: { stop_reason: stopReason, stop_sequence: null },
                            usage: { output_tokens: 0 }
                        })}\n\n`);

                        await stream.write(`event: message_stop\ndata: ${JSON.stringify({
                            type: 'message_stop'
                        })}\n\n`);
                    });
                } else {
                    const result = await generateText(options);

                    const content: any[] = [];
                    if (result.text) {
                        content.push({ type: 'text', text: result.text });
                    }
                    
                    if (result.toolCalls) {
                        for (const tc of result.toolCalls) {
                            content.push({
                                type: 'tool_use',
                                id: tc.toolCallId,
                                name: tc.toolName,
                                input: tc.args
                            });
                        }
                    }

                    return c.json({
                        id: `msg-${Date.now()}`,
                        type: 'message',
                        role: 'assistant',
                        model: modelId,
                        content,
                        stop_reason: result.finishReason === 'tool-calls' ? 'tool_use' : 'end_turn',
                        stop_sequence: null,
                        usage: {
                            input_tokens: result.usage.promptTokens,
                            output_tokens: result.usage.completionTokens
                        }
                    });
                }
            } catch (error: any) {
                return c.json({ error: { message: error.message } }, 500);
            }
        });
    }

    public fetch = (req: Request) => this.app.fetch(req);
}
