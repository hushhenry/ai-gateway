import { loadAuth } from './auth.js';

export const PROVIDER_MODELS: Record<string, string[]> = {
    openai: [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'o1',
        'o1-mini'
    ],
    anthropic: [
        'claude-opus-4-6',
        'claude-sonnet-4-5-20250514',
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-latest'
    ],
    'anthropic-token': [
        'claude-opus-4-6',
        'claude-sonnet-4-5-20250514',
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-latest'
    ],
    google: [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite-preview',
        'gemini-1.5-pro',
        'gemini-1.5-flash'
    ],
    deepseek: [
        'deepseek-chat',
        'deepseek-reasoner'
    ],
    openrouter: [
        'openrouter/auto'
    ],
    xai: [
        'grok-3',
        'grok-3-mini',
        'grok-2',
    ],
    moonshot: [
        'moonshot-v1-auto',
        'moonshot-v1-8k',
        'moonshot-v1-32k',
        'moonshot-v1-128k',
        'kimi-latest',
    ],
    zhipu: [
        'glm-4-plus',
        'glm-4-long',
        'glm-4-flash',
        'glm-4v-plus',
    ],
    groq: [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
    ],
    together: [
        'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
        'mistralai/Mixtral-8x22B-Instruct-v0.1',
        'Qwen/Qwen2.5-72B-Instruct-Turbo',
    ],
    minimax: [
        'MiniMax-Text-01',
        'abab6.5s-chat',
    ],
    ollama: [],  // dynamically discovered
    litellm: [],  // dynamically discovered
};

export async function fetchModelsForProvider(providerId: string, apiKey?: string): Promise<string[]> {
    try {
        if (providerId === 'openai' && apiKey) {
            const res = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const data = await res.json() as any;
            return data.data.map((m: any) => m.id).filter((id: string) => id.startsWith('gpt') || id.startsWith('o1'));
        }
        
        if (providerId === 'openrouter' && apiKey) {
            const res = await fetch('https://openrouter.ai/api/v1/models');
            const data = await res.json() as any;
            return data.data.map((m: any) => m.id);
        }

        if (providerId === 'google' && apiKey) {
            // Google Generative AI models list (Gemini API)
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await res.json() as any;
            return data.models
                .map((m: any) => m.name.replace('models/', ''))
                .filter((id: string) => id.includes('gemini'));
        }

        if (providerId === 'deepseek' && apiKey) {
            const res = await fetch('https://api.deepseek.com/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const data = await res.json() as any;
            return data.data.map((m: any) => m.id);
        }
    } catch (e) {
        console.error(`Failed to fetch dynamic models for ${providerId}, falling back to static list.`);
    }

    return PROVIDER_MODELS[providerId] || [];
}
