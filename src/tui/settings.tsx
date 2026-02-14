import React, { useState, useRef, useEffect } from 'react';
import { render, Text, Box, useInput } from 'ink';
import open from 'open';
import { saveAuth, loadAuth } from '../core/auth.js';
import { getGeminiAuthUrl, exchangeGeminiCode } from '../utils/oauth/google-gemini.js';
import { PROVIDER_MODELS } from '../core/models.js';
import { fetchProviderModels } from '../core/discovery.js';

const PROVIDERS = [
    { id: 'openai', name: 'OpenAI (API Key)' },
    { id: 'anthropic', name: 'Anthropic (API Key)' },
    { id: 'google', name: 'Google Gemini (API Key)' },
    { id: 'gemini-cli', name: 'Google Gemini (OAuth / gemini-cli)' },
    { id: 'antigravity', name: 'Antigravity (OAuth / Sandbox)' },
    { id: 'deepseek', name: 'DeepSeek (API Key)' },
    { id: 'openrouter', name: 'OpenRouter (API Key)' }
];

const App = () => {
    const [step, setStep] = useState<'select' | 'input' | 'oauth' | 'models' | 'done'>('select');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [apiKey, setApiKey] = useState('');
    const [oauthUrl, setOauthUrl] = useState('');
    const [verifier, setVerifier] = useState('');
    const [authCode, setAuthCode] = useState('');
    const [status, setStatus] = useState('');
    
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [modelCursor, setModelCursor] = useState(0);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [showCursor, setShowCursor] = useState(true);

    const fetchedModelsRef = useRef<string[] | null>(null);

    useEffect(() => {
        const timer = setInterval(() => setShowCursor(s => !s), 500);
        return () => clearInterval(timer);
    }, []);

    const providerId = PROVIDERS[selectedIndex]?.id;

    const prefetchModels = async (pId: string) => {
        setIsFetchingModels(true);
        try {
            const dynamicModels = await fetchProviderModels(pId);
            const finalModels = [...new Set([...(PROVIDER_MODELS[pId] || []), ...dynamicModels])];
            fetchedModelsRef.current = finalModels;
        } catch (e) {} finally {
            setIsFetchingModels(false);
        }
    };

    const moveToModelSelection = () => {
        const finalModels = fetchedModelsRef.current || PROVIDER_MODELS[providerId] || [];
        setAvailableModels(finalModels);
        setSelectedModels(finalModels);
        setStep('models');
    };

    useInput(async (input, key) => {
        if (step === 'select') {
            if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
            if (key.downArrow) setSelectedIndex(Math.min(PROVIDERS.length - 1, selectedIndex + 1));
            if (key.return) {
                const provider = PROVIDERS[selectedIndex];
                prefetchModels(provider.id);
                if (provider.id === 'gemini-cli' || provider.id === 'antigravity') {
                    const { url, verifier } = await getGeminiAuthUrl();
                    setOauthUrl(url);
                    setVerifier(verifier);
                    setStep('oauth');
                    try {
                        await open(url);
                    } catch (e) {}
                } else {
                    setStep('input');
                }
            }
        } else if (step === 'oauth') {
            if (key.return && authCode) {
                try {
                    await exchangeGeminiCode(authCode, verifier);
                    const auth = loadAuth();
                    const provider = PROVIDERS[selectedIndex];
                    const googleCreds = auth['google'];
                    if (googleCreds) {
                        auth[provider.id] = { ...googleCreds, type: 'oauth' };
                        delete auth['google'];
                        saveAuth(auth);
                    }
                    moveToModelSelection();
                } catch (e: any) {
                    setStatus(`Error: ${e.message}`);
                }
            } else if (key.backspace || key.delete) {
                setAuthCode(authCode.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setAuthCode(authCode + input);
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
                if (provider.id !== 'gemini-cli' && provider.id !== 'antigravity') {
                   auth[provider.id] = { apiKey, type: 'key', enabledModels: selectedModels };
                } else {
                   if (auth[provider.id]) {
                       auth[provider.id].enabledModels = selectedModels;
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

    if (step === 'oauth') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text>Please visit the following URL to authorize the application:</Text>
                <Box paddingY={1} flexDirection="column">
                    <Text bold color="#89B4FA">{oauthUrl}</Text>
                </Box>
                <Box flexDirection="row">
                    <Text>Enter the authorization code: </Text>
                    <Text color="#A6E3A1">{authCode}</Text>
                    {showCursor && <Text backgroundColor="#CDD6F4" color="#1E1E2E"> </Text>}
                </Box>
                {status && <Box marginTop={1}><Text color="#F38BA8">{status}</Text></Box>}
                <Box marginTop={1}>
                    <Text color="#6C7086">(Press Enter to verify, Esc to cancel)</Text>
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="#89B4FA">
            <Box marginBottom={1}>
                <Text bold color="#89B4FA">🚀 AI Gateway Configuration</Text>
            </Box>
            {step === 'select' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Select a Provider to configure:</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {PROVIDERS.map((provider, index) => (
                            <Box key={provider.id}>
                                <Text color={index === selectedIndex ? '#89B4FA' : '#6C7086'}>
                                    {index === selectedIndex ? '●' : '○'}
                                </Text>
                                <Text color={index === selectedIndex ? '#CDD6F4' : '#6C7086'} bold={index === selectedIndex}>
                                    {' '}{provider.name}
                                </Text>
                            </Box>
                        ))}
                    </Box>
                    {status && <Box marginTop={1}><Text color="#F38BA8">{status}</Text></Box>}
                </Box>
            )}
            {step === 'input' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Configuring: <Text color="#89B4FA" bold>{PROVIDERS[selectedIndex].name}</Text></Text>
                    <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="#89B4FA" minHeight={3}>
                        <Box flexDirection="row">
                            <Text color="#CDD6F4">API Key: </Text>
                            {!apiKey && <Text color="#6C7086">Type or paste key here...</Text>}
                            <Text color="#A6E3A1">
                                {'*'.repeat(apiKey.length)}
                            </Text>
                            {showCursor && <Text backgroundColor="#CDD6F4" color="#1E1E2E"> </Text>}
                        </Box>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="#6C7086">(Press Enter to continue)</Text>
                    </Box>
                </Box>
            )}
            {step === 'models' && (
                <Box flexDirection="column">
                    {isFetchingModels && !availableModels.length ? (
                        <Text color="#F9E2AF">Loading model list...</Text>
                    ) : (
                        <Box flexDirection="column">
                            <Text color="#CDD6F4">Enable models for <Text color="#89B4FA" bold>{PROVIDERS[selectedIndex].name}</Text>:</Text>
                            <Box flexDirection="column" marginTop={1}>
                                {availableModels.map((model, index) => (
                                    <Box key={model}>
                                        <Text color={index === modelCursor ? '#89B4FA' : '#6C7086'}>
                                            {index === modelCursor ? '●' : ' '}
                                        </Text>
                                        <Text color={selectedModels.includes(model) ? '#A6E3A1' : '#6C7086'}>
                                            {' '}[{selectedModels.includes(model) ? '✔' : ' '}] {model}
                                        </Text>
                                    </Box>
                                ))}
                                <Box marginTop={1}>
                                    <Text color={modelCursor === availableModels.length ? '#F9E2AF' : '#6C7086'}>
                                        {modelCursor === availableModels.length ? '●' : ' '}
                                    </Text>
                                    <Text color={modelCursor === availableModels.length ? '#F9E2AF' : '#6C7086'}>
                                        {' '}[ ] Toggle All / None
                                    </Text>
                                </Box>
                            </Box>
                            <Box marginTop={1}>
                                <Text color="#6C7086">(Space to toggle, Enter to save)</Text>
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
            {step === 'done' && (
                <Box flexDirection="column">
                    <Text color="#A6E3A1" bold>✅ Configuration saved!</Text>
                    <Box marginTop={1}>
                        <Text color="#CDD6F4">Press Enter to exit.</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export async function runLoginTui() {
    render(<App />);
}
