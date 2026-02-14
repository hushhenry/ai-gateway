import { saveAuth, loadAuth } from '../core/auth.js';

export async function fetchProviderModels(providerId: string): Promise<string[]> {
    try {
        if (providerId === 'openrouter') {
            const response = await fetch("https://openrouter.ai/api/v1/models");
            const data = await response.json() as any;
            return data.data
                .filter((m: any) => m.supported_parameters?.includes("tools"))
                .map((m: any) => m.id);
        }

        // For other providers, we can try models.dev as a source like OpenClaw does
        const response = await fetch("https://models.dev/api.json");
        const data = await response.json() as any;
        
        let providerKey = providerId;
        // Map our IDs to models.dev keys if necessary
        if (providerId === 'google') providerKey = 'google';
        if (providerId === 'openai') providerKey = 'openai';
        if (providerId === 'anthropic') providerKey = 'anthropic';
        if (providerId === 'deepseek') providerKey = 'deepseek';

        const modelsData = data[providerKey]?.models;
        if (modelsData) {
            return Object.entries(modelsData)
                .filter(([_, m]: [string, any]) => m.tool_call === true)
                .map(([id, _]) => id);
        }
    } catch (e) {
        console.error(`Failed to fetch dynamic models for ${providerId}:`, e);
    }
    return [];
}
