import React, { useState, useRef, useEffect, useMemo } from 'react';
import { render, Text, Box, useInput } from 'ink';
import open from 'open';
import readline from 'node:readline';
import { saveAuth, loadAuth } from '../core/auth.js';
import { getGeminiAuthUrl, exchangeGeminiCode } from '../utils/oauth/google-gemini.js';
import { PROVIDER_MODELS } from '../core/models.js';
import { fetchProviderModels } from '../core/discovery.js';

const PROVIDERS = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google (Gemini)', hasSubmenu: true },
    { id: 'github-copilot', name: 'GitHub Copilot (OAuth)' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openrouter', name: 'OpenRouter' }
];

const GOOGLE_SUBMENU = [
    { id: 'google', name: 'Standard (API Key)' },
    { id: 'gemini-cli', name: 'Gemini CLI (OAuth)' },
    { id: 'antigravity', name: 'Antigravity (Sandbox)' }
];

/**
 * Performs the OAuth flow outside of Ink, writing the URL directly to stdout
 * so it appears as a single unbroken clickable line in the terminal.
 * This mirrors the approach used by gemini-cli's authWithUserCode().
 */
async function performOauthFlow(providerId: string): Promise<boolean> {
    const { url, verifier } = await getGeminiAuthUrl();

    // Try to open the URL in the browser
    try { await open(url); } catch (e) {}

    // Restore stdin after Ink's unmount (which calls stdin.unref() + setRawMode(false))
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
    process.stdin.ref();
    process.stdin.resume();

    // Write URL directly to stdout — no framework wrapping, single clickable line
    process.stdout.write('\nPlease visit the following URL to authorize the application:\n\n');
    process.stdout.write(url + '\n\n');

    // Read authorization code via readline (same approach as gemini-cli)
    const code = await new Promise<string>((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
        rl.question('Enter the authorization code: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });

    if (!code) {
        process.stdout.write('Authorization code is required.\n');
        return false;
    }

    try {
        await exchangeGeminiCode(code, verifier);
        const auth = loadAuth();
        if (providerId !== 'google' && auth['google']) {
            auth[providerId] = { ...auth['google'], type: 'oauth' };
            delete auth['google'];
            saveAuth(auth);
        }
        process.stdout.write('\n✅ Authentication successful!\n\n');
        return true;
    } catch (e: any) {
        process.stdout.write(`\nError: ${e.message}\n`);
        return false;
    }
}

interface AppProps {
    initialProviderId?: string;
    skipToModels?: boolean;
    onOauthRequest?: (providerId: string) => void;
}

const App: React.FC<AppProps> = ({ initialProviderId, skipToModels, onOauthRequest }) => {
    const [step, setStep] = useState<'select' | 'google_submenu' | 'input' | 'models' | 'done'>(
        skipToModels ? 'models' : 'select'
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [googleIndex, setGoogleIndex] = useState(0);
    const [activeProviderId, setActiveProviderId] = useState(initialProviderId || '');
    const [apiKey, setApiKey] = useState('');

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

    const moveToModelSelection = (pId: string) => {
        const finalModels = fetchedModelsRef.current || PROVIDER_MODELS[pId] || [];
        setAvailableModels(finalModels);
        setSelectedModels(finalModels);
        setStep('models');
    };

    // If resuming after OAuth, prefetch models immediately
    useEffect(() => {
        if (skipToModels && initialProviderId) {
            prefetchModels(initialProviderId);
        }
    }, []);

    useInput(async (input, key) => {
        if (step === 'select') {
            if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
            if (key.downArrow) setSelectedIndex(Math.min(PROVIDERS.length - 1, selectedIndex + 1));
            if (key.return) {
                const provider = PROVIDERS[selectedIndex];
                if (provider.id === 'google') {
                    setStep('google_submenu');
                } else {
                    setActiveProviderId(provider.id);
                    prefetchModels(provider.id);
                    setStep('input');
                }
            }
        } else if (step === 'google_submenu') {
            if (key.upArrow) setGoogleIndex(Math.max(0, googleIndex - 1));
            if (key.downArrow) setGoogleIndex(Math.min(GOOGLE_SUBMENU.length - 1, googleIndex + 1));
            if (key.return) {
                const sub = GOOGLE_SUBMENU[googleIndex];
                if (sub.id === 'google') {
                    setActiveProviderId(sub.id);
                    prefetchModels(sub.id);
                    setStep('input');
                } else {
                    // Signal to parent to handle OAuth outside Ink
                    onOauthRequest?.(sub.id);
                }
            }
            if (key.escape) setStep('select');
        } else if (step === 'input') {
            if (key.return) {
                moveToModelSelection(activeProviderId);
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
                if (activeProviderId === 'google' || !auth[activeProviderId]?.apiKey) {
                    auth[activeProviderId] = { apiKey, type: 'key', enabledModels: selectedModels };
                } else {
                    if (auth[activeProviderId]) {
                        auth[activeProviderId].enabledModels = selectedModels;
                    }
                }
                saveAuth(auth);
                setStep('done');
            }
        } else if (step === 'done') {
            process.exit(0);
        }
        if (key.escape && step !== 'google_submenu') process.exit(0);
    });

    useEffect(() => {
        if (step === 'models' && !isFetchingModels && fetchedModelsRef.current && !availableModels.length) {
            setAvailableModels(fetchedModelsRef.current);
            setSelectedModels(fetchedModelsRef.current);
        }
    }, [isFetchingModels, step, availableModels]);

    const providersList = useMemo(() => PROVIDERS.map((provider, index) => (
        <Box key={provider.id}>
            <Text color={index === selectedIndex ? '#89B4FA' : '#6C7086'}>
                {index === selectedIndex ? '●' : '○'}
            </Text>
            <Text color={index === selectedIndex ? '#CDD6F4' : '#6C7086'} bold={index === selectedIndex}>
                {' '}{provider.name}
            </Text>
        </Box>
    )), [selectedIndex]);

    const googleSubmenuList = useMemo(() => GOOGLE_SUBMENU.map((sub, index) => (
        <Box key={sub.id}>
            <Text color={index === googleIndex ? '#89B4FA' : '#6C7086'}>
                {index === googleIndex ? '●' : '○'}
            </Text>
            <Text color={index === googleIndex ? '#CDD6F4' : '#6C7086'} bold={index === googleIndex}>
                {' '}{sub.name}
            </Text>
        </Box>
    )), [googleIndex]);

    const modelsList = useMemo(() => (
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
    ), [availableModels, modelCursor, selectedModels]);

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="#89B4FA">
            <Box marginBottom={1}>
                <Text bold color="#89B4FA">🚀 AI Gateway Configuration</Text>
            </Box>
            {step === 'select' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Select a Provider to configure:</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {providersList}
                    </Box>
                </Box>
            )}
            {step === 'google_submenu' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Google Gemini - Select authentication method:</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {googleSubmenuList}
                    </Box>
                    <Box marginTop={1}><Text color="#6C7086">(Esc to go back)</Text></Box>
                </Box>
            )}
            {step === 'input' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Configuring: <Text color="#89B4FA" bold>{activeProviderId}</Text></Text>
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
                            <Text color="#CDD6F4">Enable models for <Text color="#89B4FA" bold>{activeProviderId}</Text>:</Text>
                            {modelsList}
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
    let oauthProviderId: string | null = null;

    const startTui = (props: AppProps = {}) => {
        return new Promise<void>((resolve) => {
            const instance = render(
                <App
                    {...props}
                    onOauthRequest={(providerId) => {
                        oauthProviderId = providerId;
                        instance.unmount();
                    }}
                />
            );
            instance.waitUntilExit().then(resolve);
        });
    };

    // Initial TUI render
    await startTui();

    // If OAuth was requested, handle it outside Ink then resume
    while (oauthProviderId) {
        const providerId = oauthProviderId;
        oauthProviderId = null;

        const success = await performOauthFlow(providerId);
        if (success) {
            // Resume TUI at model selection step
            await startTui({ initialProviderId: providerId, skipToModels: true });
        } else {
            // OAuth failed, restart TUI from the beginning
            await startTui();
        }
    }
}
