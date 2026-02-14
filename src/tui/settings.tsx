import React, { useState } from 'react';
import { render, Text, Box, useInput } from 'ink';
import { saveAuth, loadAuth } from '../core/auth.js';
import { loginGeminiCli } from '../utils/oauth/google-gemini.js';

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
                    setStep('oauth');
                    try {
                        await loginGeminiCli();
                        setStep('done');
                    } catch (e: any) {
                        setStatus(`OAuth failed: ${e.message}`);
                        setStep('select');
                    }
                } else if (provider.id === 'github-copilot') {
                    setStatus('GitHub Copilot OAuth pending implementation.');
                } else {
                    setStep('input');
                }
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
                    <Text>Starting OAuth flow for <Text color="cyan" bold>{PROVIDERS[selectedIndex].name}</Text>...</Text>
                    <Box marginTop={1}>
                        <Text>Please check the URL printed below the TUI and follow instructions in browser.</Text>
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
                        <Text>Press any key to exit.</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export async function runLoginTui() {
    render(<App />);
}
