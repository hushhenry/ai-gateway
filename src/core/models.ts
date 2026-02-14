export const PROVIDER_MODELS: Record<string, string[]> = {
    openai: [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'o1',
        'o1-preview',
        'o1-mini',
        'o3-mini'
    ],
    anthropic: [
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-latest',
        'claude-3-opus-latest',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
    ],
    google: [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite-preview',
        'gemini-2.0-pro-exp-02-05',
        'gemini-2.0-flash-thinking-exp-01-21',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
        'gemini-1.0-pro'
    ],
    deepseek: [
        'deepseek-chat',
        'deepseek-reasoner'
    ],
    openrouter: [
        'openrouter/auto'
    ]
};
