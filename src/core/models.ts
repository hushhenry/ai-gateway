export const PROVIDER_MODELS: Record<string, string[]> = {
    openai: [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'o1-preview',
        'o1-mini',
        'o3-mini'
    ],
    anthropic: [
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-latest',
        'claude-3-opus-latest'
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
    ]
};
