import { saveAuth, loadAuth } from '../core/auth.js';
import { createInterface } from 'readline';

const PROVIDERS = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google Gemini' },
    { id: 'github-copilot', name: 'GitHub Copilot (OAuth)' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openrouter', name: 'OpenRouter' }
];

export async function runLoginTui() {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\nSelect a Provider to configure:\n');
    PROVIDERS.forEach((p, i) => {
        console.log(`${i + 1}. ${p.name}`);
    });
    console.log('');

    const ask = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

    const choice = await ask('Enter selection (1-' + PROVIDERS.length + '): ');
    const index = parseInt(choice) - 1;

    if (isNaN(index) || index < 0 || index >= PROVIDERS.length) {
        console.log('Invalid selection.');
        rl.close();
        return;
    }

    const provider = PROVIDERS[index];

    if (provider.id === 'github-copilot') {
        console.log('\nGitHub Copilot OAuth requires complex flow. Please use pi-ai login or manually add token for now.');
        rl.close();
        return;
    }

    const apiKey = await ask(`Enter API Key for ${provider.name}: `);
    
    if (apiKey) {
        const auth = loadAuth();
        auth[provider.id] = { apiKey, type: 'key' };
        saveAuth(auth);
        console.log(`\nSuccessfully saved credentials for ${provider.name}`);
    }

    rl.close();
}
