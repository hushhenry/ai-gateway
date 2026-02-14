import React, { useState, useEffect } from 'react';
import { render, Text, Box, useInput } from 'ink';
import { saveAuth, loadAuth } from '../core/auth.js';
import { getGeminiAuthUrl, exchangeGeminiCode } from '../utils/oauth/google-gemini.js';

const PROVIDERS = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google Gemini (OAuth)' },
    { id: 'github-copilot', name: 'GitHub Copilot (OAuth)' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openrouter', name: 'OpenRouter' }
];

const App = () => {
    const [step, setStep] = useState<'select' | 'input' | 'oauth' | 'done'>('select');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [apiKey, setApiKey] = useState('');
    const [oauthUrl, setOauthUrl] = useState('');
    const [verifier, setVerifier] = useState('');
    const [callbackUrl, setCallbackUrl] = useState('');
    const [status, setStatus] = useState('');

    useInput(async (input, key) => {
        if (step === 'select') {
            if (key.upArrow) {
                setSelectedIndex(Math.max(0, selectedIndex - 1));
            }
            if (key.downArrow) {
                setSelectedIndex(Math.min(PROVIDERS.length - 1, selectedIndex + 1));
            }
            if (key.return) {
                const provider = PROVIDERS[selectedIndex];
                if (provider.id === 'google') {
                    const { url, verifier } = await getGeminiAuthUrl();
                    setOauthUrl(url);
                    setVerifier(verifier);
                    setStep('oauth');
                } else if (provider.id === 'github-copilot') {
                    setStatus('GitHub Copilot OAuth pending implementation.');
                } else {
                    setStep('input');
                }
            }
        } else if (step === 'oauth') {
            if (key.return && callbackUrl) {
                try {
                    const urlObj = new URL(callbackUrl.trim());
                    const code = urlObj.searchParams.get('code');
                    const state = urlObj.searchParams.get('state');
                    
                    if (!code) throw new Error('No code found in URL');
                    if (state !== verifier) throw new Error('State mismatch (security check failed)');
                    
                    await exchangeGeminiCode(code, verifier);
                    setStep('done');
                } catch (e: any) {
                    setStatus(`Error: ${e.message}`);
                }
            } else if (key.backspace || key.delete) {
                setCallbackUrl(callbackUrl.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setCallbackUrl(callbackUrl + input);
            }
        } else if (step === 'input') {
            if (key.return) {
                const provider = PROVIDERS[selectedIndex];
                const auth = loadAuth();
                auth[provider.id] = { apiKey, type: 'key' };
                saveAuth(auth);
                setStep('done');
            } else if (key.backspace || key.delete) {
                setApiKey(apiKey.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setApiKey(apiKey + input);
            }
        } else if (step === 'done') {
            process.exit(0);
        }

        if (key.escape) {
            process.exit(0);
        }
    });

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
            <Box marginBottom={1}>
                <Text bold color="yellow">🚀 AI Gateway Configuration</Text>
            </Box>

            {step === 'select' && (
                <Box flexDirection="column">
                    <Text>Select a Provider to configure (Use arrows, Enter to confirm):</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {PROVIDERS.map((provider, index) => (
                            <Text key={provider.id} color={index === selectedIndex ? 'cyan' : undefined}>
                                {index === selectedIndex ? ' > ' : '   '}
                                {provider.name}
                            </Text>
                        ))}
                    </Box>
                    {status && (
                        <Box marginTop={1}>
                            <Text color="red">{status}</Text>
                        </Box>
                    )}
                </Box>
            )}

            {step === 'oauth' && (
                <Box flexDirection="column">
                    <Text>1. Open this URL in your browser to login:</Text>
                    <Box paddingLeft={3} marginTop={1} marginBottom={1}>
                        <Text color="blue" underline>{oauthUrl}</Text>
                    </Box>
                    <Text>2. After login, paste the full redirect URL (localhost:8085/...) here:</Text>
                    <Box marginTop={1} paddingLeft={3} borderStyle="single" borderColor="gray">
                        <Text color="green">{callbackUrl || 'Paste URL here...'}</Text>
                    </Box>
                    {status && (
                        <Box marginTop={1}>
                            <Text color="red">{status}</Text>
                        </Box>
                    )}
                    <Box marginTop={1}>
                        <Text color="gray">(Press Enter to verify, Esc to cancel)</Text>
                    </Box>
                </Box>
            )}

            {step === 'input' && (
                <Box flexDirection="column">
                    <Text>Configuring: <Text color="cyan" bold>{PROVIDERS[selectedIndex].name}</Text></Text>
                    <Box marginTop={1}>
                        <Text>Enter API Key: </Text>
                        <Text color="green">{'*'.repeat(apiKey.length)}</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">(Press Enter to save, Esc to cancel)</Text>
                    </Box>
                </Box>
            )}

            {step === 'done' && (
                <Box flexDirection="column">
                    <Text color="green" bold>✅ Successfully saved credentials for {PROVIDERS[selectedIndex].name}!</Text>
                    <Box marginTop={1}>
                        <Text>Press Enter or any key to exit.</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export async function runLoginTui() {
    render(<App />);
}
