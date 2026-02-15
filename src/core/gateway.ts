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
                
                const options = {
                    model: provider,
                    messages: body.messages,
                    temperature: body.temperature,
                    topP: body.top_p,
                    maxTokens: body.max_tokens,
                };

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
                                                    arguments: part.args
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
                                            arguments: tc.args
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
    }

    public fetch = (req: Request) => this.app.fetch(req);
}
