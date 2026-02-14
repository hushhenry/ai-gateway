import { Hono } from 'hono';
import { streamText } from 'ai';
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
                        id: `${providerId}:${modelId}`,
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
            
            try {
                const provider = await getProvider(modelId, this.configPath);
                
                const result = await streamText({
                    model: provider,
                    messages: body.messages,
                    temperature: body.temperature,
                    topP: body.top_p,
                    maxTokens: body.max_tokens,
                });

                return result.toDataStreamResponse();
            } catch (error: any) {
                return c.json({ error: { message: error.message } }, 500);
            }
        });
    }

    public fetch = (req: Request) => this.app.fetch(req);
}
