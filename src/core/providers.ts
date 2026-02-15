import { loadAuth, getCredentials, type Credentials } from './auth.js';
import { GeminiCliProvider } from './gemini-cli-provider.js';

const GEMINI_CLI_HEADERS = {
    "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": JSON.stringify({
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
    }),
};

export async function getProvider(modelId: string, configPath?: string) {
    if (!modelId.includes('/')) {
        throw new Error(`Invalid model ID format: "${modelId}". Expected "provider/model"`);
    }

    const [providerBrand, ...modelNameParts] = modelId.split('/');
    const modelName = modelNameParts.join('/');
    
    const creds = await getCredentials(providerBrand, configPath);

    if (!creds || !creds.apiKey) {
        throw new Error(`No credentials found for provider: "${providerBrand}" (extracted from "${modelId}")`);
    }

    switch (providerBrand) {
        case 'openai': {
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({ apiKey: creds.apiKey })(modelName);
        }
        case 'anthropic': {
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            return createAnthropic({ apiKey: creds.apiKey })(modelName);
        }
        case 'anthropic-token': {
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            return createAnthropic({ 
                apiKey: '', // Disable default x-api-key
                headers: {
                    'Authorization': `Bearer ${creds.apiKey}`,
                    'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
                    'user-agent': 'claude-cli/0.2.29 (external, cli)',
                    'x-app': 'cli'
                }
            })(modelName);
        }
        case 'google': {
            const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
            return createGoogleGenerativeAI({ apiKey: creds.apiKey })(modelName);
        }
        case 'gemini-cli': {
            return new GeminiCliProvider(
                modelName,
                creds.apiKey,
                creds.projectId
            ) as any;
        }
        case 'antigravity': {
            return new GeminiCliProvider(
                modelName,
                creds.apiKey,
                creds.projectId,
                true
            ) as any;
        }
        case 'deepseek': {
            const { createOpenAI: createDeepSeek } = await import('@ai-sdk/openai');
            return createDeepSeek({ 
                apiKey: creds.apiKey,
                baseURL: 'https://api.deepseek.com/v1' 
            })(modelName);
        }
        case 'openrouter': {
            const { createOpenAI: createOpenRouter } = await import('@ai-sdk/openai');
            return createOpenRouter({ 
                apiKey: creds.apiKey,
                baseURL: 'https://openrouter.ai/api/v1' 
            })(modelName);
        }
        case 'xai': {
            const { createOpenAI: createXAI } = await import('@ai-sdk/openai');
            return createXAI({
                apiKey: creds.apiKey,
                baseURL: 'https://api.x.ai/v1'
            })(modelName);
        }
        case 'moonshot': {
            const { createOpenAI: createMoonshot } = await import('@ai-sdk/openai');
            return createMoonshot({
                apiKey: creds.apiKey,
                baseURL: 'https://api.moonshot.cn/v1'
            })(modelName);
        }
        case 'zhipu': {
            const { createOpenAI: createZhipu } = await import('@ai-sdk/openai');
            return createZhipu({
                apiKey: creds.apiKey,
                baseURL: 'https://open.bigmodel.cn/api/paas/v4'
            })(modelName);
        }
        case 'groq': {
            const { createOpenAI: createGroq } = await import('@ai-sdk/openai');
            return createGroq({
                apiKey: creds.apiKey,
                baseURL: 'https://api.groq.com/openai/v1'
            })(modelName);
        }
        case 'together': {
            const { createOpenAI: createTogether } = await import('@ai-sdk/openai');
            return createTogether({
                apiKey: creds.apiKey,
                baseURL: 'https://api.together.xyz/v1'
            })(modelName);
        }
        case 'minimax': {
            const { createOpenAI: createMinimax } = await import('@ai-sdk/openai');
            return createMinimax({
                apiKey: creds.apiKey,
                baseURL: 'https://api.minimax.chat/v1'
            })(modelName);
        }
        case 'ollama': {
            const { createOpenAI: createOllama } = await import('@ai-sdk/openai');
            return createOllama({
                apiKey: 'ollama',  // Ollama doesn't need a real key
                baseURL: creds.apiKey || 'http://localhost:11434/v1'
            })(modelName);
        }
        case 'litellm': {
            const { createOpenAI: createLiteLLM } = await import('@ai-sdk/openai');
            return createLiteLLM({
                apiKey: creds.apiKey || 'unused',
                baseURL: creds.projectId || 'http://localhost:4000/v1'  // LiteLLM proxy URL stored in projectId
            })(modelName);
        }
        case 'azure': {
            const { createAzure } = await import('@ai-sdk/azure');
            // creds.apiKey = Azure API key
            // creds.projectId = resource name (e.g., "my-resource")
            // The model name is the deployment name
            const resourceName = creds.projectId;
            if (!resourceName) {
                throw new Error('Azure OpenAI requires a resource name. Set it via the TUI or auth.json (projectId field).');
            }
            return createAzure({
                apiKey: creds.apiKey,
                resourceName,
            })(modelName);
        }
        case 'vertex': {
            const { createVertex } = await import('@ai-sdk/google-vertex');
            // creds.projectId = Google Cloud project ID
            // creds.apiKey = location (e.g., "us-central1"), stored as apiKey for simplicity
            const project = creds.projectId;
            const location = creds.apiKey || 'us-central1';
            if (!project) {
                throw new Error('Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT or configure via TUI.');
            }
            return createVertex({
                project,
                location,
            })(modelName);
        }
        case 'bedrock': {
            const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
            // creds.apiKey = AWS access key ID
            // creds.projectId = AWS secret access key
            // creds.refresh = AWS region (reusing refresh field)
            const region = creds.refresh || process.env.AWS_REGION || 'us-east-1';
            // If credentials are provided, use them; otherwise rely on AWS SDK default chain
            const bedrockConfig: any = { region };
            if (creds.apiKey && creds.projectId) {
                bedrockConfig.accessKeyId = creds.apiKey;
                bedrockConfig.secretAccessKey = creds.projectId;
            }
            return createAmazonBedrock(bedrockConfig)(modelName);
        }
        default:
            throw new Error(`Unsupported provider: ${providerBrand}`);
    }
}
