import React, { useState, useRef, useEffect } from 'react';
import { render, Text, Box, useInput } from 'ink';
import Link from 'ink-link';
import { saveAuth, loadAuth } from '../core/auth.js';
import { getGeminiAuthUrl, exchangeGeminiCode } from '../utils/oauth/google-gemini.js';
import { PROVIDER_MODELS } from '../core/models.js';
import { fetchProviderModels } from '../core/discovery.js';

const PROVIDERS = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google Gemini (OAuth)' },
    { id: 'github-copilot', name: 'GitHub Copilot (OAuth)' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openrouter', name: 'OpenRouter' }
];

const App = () => {
    const [step, setStep] = useState<'select' | 'input' | 'oauth' | 'models' | 'done'>('select');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [apiKey, setApiKey] = useState('');
    const [oauthUrl, setOauthUrl] = useState('');
    const [verifier, setVerifier] = useState('');
    const [callbackUrl, setCallbackUrl] = useState('');
    const [status, setStatus] = useState('');
    
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [modelCursor, setModelCursor] = useState(0);
    const [isFetchingModels, setIsFetchingModels] = useState(false);

    const fetchedModelsRef = useRef<string[] | null>(null);

    const providerId = PROVIDERS[selectedIndex]?.id;

    const prefetchModels = async (pId: string) => {
        setIsFetchingModels(true);
        try {
            const dynamicModels = await fetchProviderModels(pId);
            const finalModels = [...new Set([...(PROVIDER_MODELS[pId] || []), ...dynamicModels])];
            fetchedModelsRef.current = finalModels;
        } catch (e) {
            console.error('Background fetch failed', e);
        } finally {
            setIsFetchingModels(false);
        }
    };

    const moveToModelSelection = () => {
        if (fetchedModelsRef.current) {
            setAvailableModels(fetchedModelsRef.current);
            setSelectedModels(fetchedModelsRef.current);
            setStep('models');
        } else if (isFetchingModels) {
            setStep('models');
        } else {
            const fallback = PROVIDER_MODELS[providerId] || [];
            setAvailableModels(fallback);
            setSelectedModels(fallback);
            setStep('models');
        }
    };

    useInput(async (input, key) => {
        if (step === 'select') {
            if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
            if (key.downArrow) setSelectedIndex(Math.min(PROVIDERS.length - 1, selectedIndex + 1));
            if (key.return) {
                const provider = PROVIDERS[selectedIndex];
                prefetchModels(provider.id);
                if (provider.id === 'google') {
                    const { url, verifier } = await getGeminiAuthUrl();
                    setOauthUrl(url);
                    setVerifier(verifier);
                    setStep('oauth');
                } else if (provider.id === 'github-copilot') {
                    setStatus('GitHub Copilot OAuth pending.');
                } else {
                    setStep('input');
                }
            }
        } else if (step === 'oauth') {
            if (key.return && callbackUrl) {
                try {
                    const urlStr = callbackUrl.trim();
                    let code = '';
                    let state = '';
                    if (urlStr.startsWith('http')) {
                        const urlObj = new URL(urlStr);
                        code = urlObj.searchParams.get('code') || '';
                        state = urlObj.searchParams.get('state') || '';
                    } else {
                        const params = new URLSearchParams(urlStr.includes('?') ? urlStr.split('?')[1] : urlStr);
                        code = params.get('code') || '';
                        state = params.get('state') || '';
                    }
                    if (!code) throw new Error('No code found');
                    if (state && state !== verifier) throw new Error('State mismatch');
                    await exchangeGeminiCode(code, verifier);
                    moveToModelSelection();
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
                moveToModelSelection();
            } else if (key.backspace || key.delete) {
                setApiKey(apiKey.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setApiKey(apiKey + input);
            }
        } else if (step === 'models') {
            if (isFetchingModels && !availableModels.length) return;
            if (key.upArrow) setModelCursor(Math.max(0, modelCursor - 1));
            if (key.downArrow) setModelCursor(Math.min(availableModels.length, modelCursor + 1));
            if (input === ' ') {
                if (modelCursor === availableModels.length) {
                    if (selectedModels.length === availableModels.length) {
                        setSelectedModels([]);
                    } else {
                        setSelectedModels(availableModels);
                    }
                } else {
                    const model = availableModels[modelCursor];
                    if (selectedModels.includes(model)) {
                        setSelectedModels(selectedModels.filter(m => m !== model));
                    } else {
                        setSelectedModels([...selectedModels, model]);
                    }
                }
            }
            if (key.return) {
                const auth = loadAuth();
                const provider = PROVIDERS[selectedIndex];
                if (provider.id !== 'google') {
                   auth[provider.id] = { apiKey, type: 'key', enabledModels: selectedModels };
                } else {
                   if (auth['google']) {
                       auth['google'].enabledModels = selectedModels;
                   }
                }
                saveAuth(auth);
                setStep('done');
            }
        } else if (step === 'done') {
            process.exit(0);
        }
        if (key.escape) process.exit(0);
    });

    useEffect(() => {
        if (step === 'models' && !isFetchingModels && fetchedModelsRef.current && !availableModels.length) {
            setAvailableModels(fetchedModelsRef.current);
            setSelectedModels(fetchedModelsRef.current);
        }
    }, [isFetchingModels, step, availableModels]);

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
            <Box marginBottom={1}>
                <Text bold color="yellow">🚀 AI Gateway Configuration</Text>
            </Box>
            {step === 'select' && (
                <Box flexDirection="column">
                    <Text>Select a Provider to configure:</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {PROVIDERS.map((provider, index) => (
                            <Text key={provider.id} color={index === selectedIndex ? 'cyan' : undefined}>
                                {index === selectedIndex ? ' > ' : '   '}
                                {provider.name}
                            </Text>
                        ))}
                    </Box>
                    {status && <Box marginTop={1}><Text color="red">{status}</Text></Box>}
                </Box>
            )}
            {step === 'oauth' && (
                <Box flexDirection="column">
                    <Text>1. Click or copy the URL below to authorize:</Text>
                    <Box marginTop={1} marginBottom={1}>
                        <Link url={oauthUrl}>
                            <Text color="blue" bold>{oauthUrl}</Text>
                        </Link>
                    </Box>
                    <Text>2. Paste the full redirect URL (localhost:8085/...) below:</Text>
                    <Box marginTop={1} paddingX={1} borderStyle="single" borderColor="gray">
                        <Text color="green">{callbackUrl || 'Paste URL here...'}</Text>
                    </Box>
                    {status && <Box marginTop={1}><Text color="red">{status}</Text></Box>}
                    <Box marginTop={1}>
                        <Text color="gray">(Press Enter to verify, Esc to cancel)</Text>
                    </Box>
                    {isFetchingModels && (
                        <Box marginTop={1}>
                            <Text color="yellow">⏳ (Background) Fetching model list...</Text>
                        </Box>
                    )}
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
                        <Text color="gray">(Press Enter to continue)</Text>
                    </Box>
                    {isFetchingModels && (
                        <Box marginTop={1}>
                            <Text color="yellow">⏳ (Background) Fetching model list...</Text>
                        </Box>
                    )}
                </Box>
            )}
            {step === 'models' && (
                <Box flexDirection="column">
                    {isFetchingModels && !availableModels.length ? (
                        <Text color="yellow">Loading model list, please wait...</Text>
                    ) : (
                        <>
                            <Text>Select models to enable for <Text color="cyan" bold>{PROVIDERS[selectedIndex].name}</Text>:</Text>
                            <Box flexDirection="column" marginTop={1}>
                                {availableModels.map((model, index) => (
                                    <Text key={model} color={index === modelCursor ? 'cyan' : undefined}>
                                        {index === modelCursor ? ' > ' : '   '}
                                        [{selectedModels.includes(model) ? 'x' : ' '}] {model}
                                    </Text>
                                ))}
                                <Text color={modelCursor === availableModels.length ? 'yellow' : undefined}>
                                    {modelCursor === availableModels.length ? ' > ' : '   '}
                                    [ ] Toggle All / None
                                </Text>
                            </Box>
                            <Box marginTop={1}>
                                <Text color="gray">(Space to toggle, Enter to save)</Text>
                            </Box>
                        </>
                    )}
                </Box>
            )}
            {step === 'done' && (
                <Box flexDirection="column">
                    <Text color="green" bold>✅ Configuration saved successfully!</Text>
                    <Box marginTop={1}>
                        <Text>Press Enter to exit.</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export async function runLoginTui() {
    render(<App />);
}
