import { OpenAIProvider } from '@ai-sdk/openai';
import { AnthropicProvider } from '@ai-sdk/anthropic';
import { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { loadAuth, getCredentials } from './auth.js';

export async function getProvider(modelId: string, configPath?: string) {
    // Basic routing logic: provider:model
    const [providerBrand, ...modelNameParts] = modelId.split(':');
    const modelName = modelNameParts.join(':');
    const creds = await getCredentials(providerBrand, configPath);

    if (!creds) throw new Error(`No credentials found for provider: ${providerBrand}`);

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
        default:
            throw new Error(`Unsupported provider: ${providerBrand}`);
    }
}
