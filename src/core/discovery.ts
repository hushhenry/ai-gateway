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
        // Map our IDs to models.dev keys
        if (providerId === 'google') providerKey = 'google';
        if (providerId === 'gemini-cli') providerKey = 'google'; // gemini-cli uses google models but from a different endpoint
        if (providerId === 'antigravity') providerKey = 'google';
        if (providerId === 'openai') providerKey = 'openai';
        if (providerId === 'anthropic') providerKey = 'anthropic';
        if (providerId === 'deepseek') providerKey = 'deepseek';

        const modelsData = data[providerKey]?.models;
        if (modelsData) {
            let models = Object.entries(modelsData)
                .filter(([_, m]: [string, any]) => m.tool_call === true)
                .map(([id, _]) => id);
            
            // For gemini-cli and antigravity, we add some specific ones if it's the right provider
            if (providerId === 'gemini-cli') {
                // Gemini CLI specific models
                models.push('gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview', 'gemini-3-flash-preview');
            }
            if (providerId === 'antigravity') {
                models.push('gemini-3-pro-high', 'gemini-3-pro-low', 'gemini-3-flash', 'claude-sonnet-4-5', 'claude-sonnet-4-5-thinking');
            }

            return [...new Set(models)];
        }
    } catch (e) {
        console.error(`Failed to fetch dynamic models for ${providerId}:`, e);
    }
    return [];
}
