import { loadAuth, getCredentials } from './auth.js';
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
        default:
            throw new Error(`Unsupported provider: ${providerBrand}`);
    }
}
