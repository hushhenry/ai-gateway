import { Hono } from 'hono';
import { streamText, generateText } from 'ai';
import { stream } from 'hono/streaming';
import { getProvider } from './providers.js';
import { loadAuth } from './auth.js';

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
                            parameters: fn.parameters,
                        };
                        return acc;
                    }, {});
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
                
                // Convert Anthropic messages to Vercel AI SDK format
                // Vercel AI SDK handles system prompt automatically if passed in options
                const options: any = {
                    model: provider,
                    messages: body.messages,
                    system: body.system,
                    temperature: body.temperature,
                    topP: body.top_p,
                    maxTokens: body.max_tokens,
                };

                // Support Anthropic tools
                if (body.tools) {
                    options.tools = body.tools.reduce((acc: any, tool: any) => {
                        acc[tool.name] = {
                            description: tool.description,
                            parameters: tool.input_schema,
                        };
                        return acc;
                    }, {});
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

                        for await (const part of result.fullStream) {
                            if (part.type === 'text-delta') {
                                if (currentBlockIndex === -1) {
                                    currentBlockIndex = 0;
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

                                await stream.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                    type: 'content_block_delta',
                                    index: currentBlockIndex,
                                    delta: { 
                                        type: 'input_json_delta', 
                                        partial_json: JSON.stringify(part.args) 
                                    }
                                })}\n\n`);

                                await stream.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                    type: 'content_block_stop',
                                    index: currentBlockIndex
                                })}\n\n`);
                            }
                        }

                        if (currentBlockIndex === 0) {
                            await stream.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                type: 'content_block_stop',
                                index: 0
                            })}\n\n`);
                        }

                        await stream.write(`event: message_delta\ndata: ${JSON.stringify({
                            type: 'message_delta',
                            delta: { stop_reason: 'end_turn', stop_sequence: null },
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
