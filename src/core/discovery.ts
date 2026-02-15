import { loadAuth } from '../core/auth.js';

/**
 * Fetch Anthropic models using /v1/models endpoint.
 * Works with both API key (x-api-key header) and OAuth token (Bearer auth).
 */
async function fetchAnthropicModels(apiKey: string, isOAuthToken: boolean): Promise<string[]> {
    const headers: Record<string, string> = {
        'anthropic-version': '2023-06-01',
    };

    if (isOAuthToken) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
        headers['user-agent'] = 'claude-cli/0.2.29 (external, cli)';
        headers['x-app'] = 'cli';
    } else {
        headers['x-api-key'] = apiKey;
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/models', { headers });
        if (!response.ok) {
            console.error(`Anthropic models API returned ${response.status}`);
            return [];
        }
        const data = await response.json() as any;
        if (data.data && Array.isArray(data.data)) {
            return data.data
                .map((m: any) => m.id)
                .filter((id: string) => id && typeof id === 'string');
        }
    } catch (e) {
        console.error('Failed to fetch Anthropic models:', e);
    }
    return [];
}

/**
 * Fetch models from an OpenAI-compatible /v1/models endpoint.
 */
async function fetchOpenAICompatModels(baseURL: string, apiKey: string): Promise<string[]> {
    try {
        const res = await fetch(`${baseURL}/models`, {
            headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
        });
        if (!res.ok) return [];
        const data = await res.json() as any;
        if (data.data && Array.isArray(data.data)) {
            return data.data.map((m: any) => m.id).filter((id: string) => id && typeof id === 'string');
        }
    } catch {}
    return [];
}

const OPENAI_COMPAT_PROVIDERS: Record<string, string> = {
    xai: 'https://api.x.ai/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    groq: 'https://api.groq.com/openai/v1',
    together: 'https://api.together.xyz/v1',
    minimax: 'https://api.minimax.chat/v1',
    cerebras: 'https://api.cerebras.ai/v1',
    mistral: 'https://api.mistral.ai/v1',
    huggingface: 'https://router.huggingface.co/v1',
    opencode: 'https://opencode.ai/zen/v1',
    zai: 'https://api.z.ai/api/coding/paas/v4',
};

export async function fetchProviderModels(providerId: string, configPath?: string): Promise<string[]> {
    try {
        // For anthropic and anthropic-token, try the Anthropic /v1/models API with credentials
        if (providerId === 'anthropic' || providerId === 'anthropic-token') {
            const auth = loadAuth(configPath);
            const creds = auth[providerId];
            if (creds?.apiKey) {
                const isOAuth = providerId === 'anthropic-token' || creds.apiKey.includes('sk-ant-oat');
                const models = await fetchAnthropicModels(creds.apiKey, isOAuth);
                if (models.length > 0) return models;
            }
        }

        if (providerId === 'openrouter') {
            const response = await fetch("https://openrouter.ai/api/v1/models");
            const data = await response.json() as any;
            return data.data
                .filter((m: any) => m.supported_parameters?.includes("tools"))
                .map((m: any) => m.id);
        }

        // Ollama: local instance, fetch from /v1/models
        if (providerId === 'ollama') {
            const auth = loadAuth(configPath);
            const baseURL = auth[providerId]?.apiKey || 'http://localhost:11434/v1';
            return await fetchOpenAICompatModels(baseURL, '');
        }

        // LiteLLM: local proxy, fetch from /v1/models
        if (providerId === 'litellm') {
            const auth = loadAuth(configPath);
            const baseURL = auth[providerId]?.projectId || 'http://localhost:4000/v1';
            const apiKey = auth[providerId]?.apiKey || '';
            return await fetchOpenAICompatModels(baseURL, apiKey);
        }

        // OpenAI-compatible providers: try their /v1/models endpoint
        if (OPENAI_COMPAT_PROVIDERS[providerId]) {
            const auth = loadAuth(configPath);
            const creds = auth[providerId];
            if (creds?.apiKey) {
                const models = await fetchOpenAICompatModels(
                    OPENAI_COMPAT_PROVIDERS[providerId],
                    creds.apiKey,
                );
                if (models.length > 0) return models;
            }
        }

        // For other providers, use models.dev as a fallback source
        const response = await fetch("https://models.dev/api.json");
        const data = await response.json() as any;
        
        let providerKey = providerId;
        if (providerId === 'google') providerKey = 'google';
        if (providerId === 'gemini-cli') providerKey = 'google';
        if (providerId === 'antigravity') providerKey = 'google';
        if (providerId === 'openai') providerKey = 'openai';
        if (providerId === 'anthropic' || providerId === 'anthropic-token') providerKey = 'anthropic';
        if (providerId === 'deepseek') providerKey = 'deepseek';

        const modelsData = data[providerKey]?.models;
        if (modelsData) {
            let models = Object.entries(modelsData)
                .filter(([_, m]: [string, any]) => m.tool_call === true)
                .map(([id, _]) => id);
            
            if (providerId === 'gemini-cli') {
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
