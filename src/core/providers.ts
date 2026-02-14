import { loadAuth, getCredentials } from './auth.js';

export async function getProvider(modelId: string, configPath?: string) {
    // Standardize input: handle both "provider/model" and "provider:model"
    const delimiter = modelId.includes('/') ? '/' : (modelId.includes(':') ? ':' : null);
    
    if (!delimiter) {
        throw new Error(`Invalid model ID format: "${modelId}". Expected "provider/model"`);
    }

    const [providerBrand, ...modelNameParts] = modelId.split(delimiter);
    const modelName = modelNameParts.join(delimiter);
    
    const creds = await getCredentials(providerBrand, configPath);

    if (!creds) {
        throw new Error(`No credentials found for provider: "${providerBrand}" (extracted from "${modelId}")`);
    }

    switch (providerBrand) {
        case 'openai':
            const { createOpenAI } = await import('@ai-sdk/openai');
            return createOpenAI({ apiKey: creds.apiKey })(modelName);
        case 'anthropic':
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            return createAnthropic({ apiKey: creds.apiKey })(modelName);
        case 'google':
            const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
            return createGoogleGenerativeAI({ apiKey: creds.apiKey })(modelName);
        case 'deepseek':
            const { createOpenAI: createDeepSeek } = await import('@ai-sdk/openai');
            return createDeepSeek({ 
                apiKey: creds.apiKey,
                baseURL: 'https://api.deepseek.com/v1' 
            })(modelName);
        case 'openrouter':
            const { createOpenAI: createOpenRouter } = await import('@ai-sdk/openai');
            return createOpenRouter({ 
                apiKey: creds.apiKey,
                baseURL: 'https://openrouter.ai/api/v1' 
            })(modelName);
        default:
            throw new Error(`Unsupported provider: ${providerBrand}`);
    }
}
