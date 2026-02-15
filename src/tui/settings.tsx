import React, { useState, useRef, useEffect, useMemo } from 'react';
import { render, Text, Box, useInput } from 'ink';
import open from 'open';
import readline from 'node:readline';
import { saveAuth, loadAuth } from '../core/auth.js';
import { getGeminiAuthUrl, exchangeGeminiCode } from '../utils/oauth/google-gemini.js';
import { loginGitHubCopilot } from '../utils/oauth/github-copilot.js';
import { loginOpenAICodex } from '../utils/oauth/openai-codex.js';
import { loginQwenCli } from '../utils/oauth/qwen-cli.js';
import { PROVIDER_MODELS } from '../core/models.js';
import { fetchProviderModels } from '../core/discovery.js';

const PROVIDERS = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic', hasSubmenu: true },
    { id: 'google', name: 'Google (Gemini)', hasSubmenu: true },
    { id: 'github-copilot', name: 'GitHub Copilot (OAuth)' },
    { id: 'openai-codex', name: 'OpenAI Codex / ChatGPT (OAuth)' },
    { id: 'qwen-cli', name: 'Qwen CLI (OAuth)' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'xai', name: 'xAI (Grok)' },
    { id: 'moonshot', name: 'Moonshot (Kimi)' },
    { id: 'zhipu', name: 'Zhipu AI (GLM)' },
    { id: 'cerebras', name: 'Cerebras' },
    { id: 'mistral', name: 'Mistral AI' },
    { id: 'huggingface', name: 'Hugging Face' },
    { id: 'opencode', name: 'OpenCode' },
    { id: 'zai', name: 'Z.AI (Zhipu Coding)' },
    { id: 'minimax-cn', name: 'MiniMax CN (Anthropic API)' },
    { id: 'kimi-coding', name: 'Kimi Coding' },
    { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway' },
    { id: 'groq', name: 'Groq' },
    { id: 'together', name: 'Together AI' },
    { id: 'minimax', name: 'MiniMax' },
    { id: 'ollama', name: 'Ollama (Local)' },
    { id: 'litellm', name: 'LiteLLM (Proxy)' },
    { id: 'azure', name: 'Azure OpenAI' },
    { id: 'vertex', name: 'Google Vertex AI' },
    { id: 'bedrock', name: 'Amazon Bedrock' },
    { id: 'cursor', name: 'Cursor ACP' },
];

const ANTHROPIC_SUBMENU = [
    { id: 'anthropic', name: 'Anthropic API key' },
    { id: 'anthropic-token', name: 'Anthropic token (paste setup-token)' },
    { id: 'back', name: 'Back' }
];

const GOOGLE_SUBMENU = [
    { id: 'google', name: 'Standard (API Key)' },
    { id: 'gemini-cli', name: 'Gemini CLI (OAuth)' },
    { id: 'antigravity', name: 'Antigravity (Sandbox)' }
];

const OAUTH_PROVIDERS = ['gemini-cli', 'antigravity', 'github-copilot', 'openai-codex', 'qwen-cli'];

/**
 * Restore stdin after Ink's unmount (which calls stdin.unref() + setRawMode(false))
 */
function restoreStdin() {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
    process.stdin.ref();
    process.stdin.resume();
}

/**
 * Prompt for input via readline.
 */
function promptInput(message: string): Promise<string> {
    return new Promise<string>((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Performs the Gemini OAuth flow outside of Ink.
 */
async function performGeminiOauthFlow(providerId: string): Promise<boolean> {
    const { url, verifier } = await getGeminiAuthUrl();

    try { await open(url); } catch (e) {}

    restoreStdin();

    process.stdout.write('\nPlease visit the following URL to authorize the application:\n\n');
    process.stdout.write(url + '\n\n');

    const code = await promptInput('Enter the authorization code: ');

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

/**
 * Performs GitHub Copilot device code OAuth flow outside of Ink.
 */
async function performGitHubCopilotOauthFlow(): Promise<boolean> {
    restoreStdin();

    try {
        const result = await loginGitHubCopilot();
        
        process.stdout.write('\n🔗 GitHub Copilot Authentication\n');
        process.stdout.write(`\nPlease visit: ${result.auth.verification_uri}\n`);
        process.stdout.write(`Enter code: ${result.auth.user_code}\n\n`);

        try { await open(result.auth.verification_uri); } catch {}

        process.stdout.write('Waiting for authorization...\n');
        const creds = await result.poll();

        const auth = loadAuth();
        auth['github-copilot'] = {
            apiKey: creds.apiKey,
            refresh: creds.refresh,
            projectId: creds.projectId,
            expires: creds.expires,
            type: 'oauth',
        };
        saveAuth(auth);

        process.stdout.write('\n✅ GitHub Copilot authentication successful!\n\n');
        return true;
    } catch (e: any) {
        process.stdout.write(`\nError: ${e.message}\n`);
        return false;
    }
}

/**
 * Performs OpenAI Codex OAuth flow outside of Ink.
 */
async function performOpenAICodexOauthFlow(): Promise<boolean> {
    restoreStdin();

    try {
        const creds = await loginOpenAICodex({
            onAuth: (url) => {
                process.stdout.write('\n🔗 OpenAI Codex Authentication\n');
                process.stdout.write(`\nPlease visit: ${url}\n`);
                process.stdout.write('A browser window should open. Complete login to finish.\n\n');
                try { open(url); } catch {}
            },
            onPrompt: (message) => promptInput(message + ' '),
        });

        const auth = loadAuth();
        auth['openai-codex'] = {
            apiKey: creds.apiKey,
            refresh: creds.refresh,
            projectId: creds.projectId,
            expires: creds.expires,
            type: 'oauth',
        };
        saveAuth(auth);

        process.stdout.write('\n✅ OpenAI Codex authentication successful!\n\n');
        return true;
    } catch (e: any) {
        process.stdout.write(`\nError: ${e.message}\n`);
        return false;
    }
}

/**
 * Performs Qwen CLI device code OAuth flow outside of Ink.
 */
async function performQwenCliOauthFlow(): Promise<boolean> {
    restoreStdin();

    try {
        const result = await loginQwenCli();

        process.stdout.write('\n🔗 Qwen CLI Authentication\n');
        process.stdout.write(`\nPlease visit: ${result.verificationUri}\n`);
        process.stdout.write(`Enter code: ${result.userCode}\n\n`);

        try { await open(result.verificationUri); } catch {}

        process.stdout.write('Waiting for authorization...\n');
        const creds = await result.poll();

        const auth = loadAuth();
        auth['qwen-cli'] = {
            apiKey: creds.apiKey,
            refresh: creds.refresh,
            projectId: creds.projectId,
            expires: creds.expires,
            type: 'oauth',
        };
        saveAuth(auth);

        process.stdout.write('\n✅ Qwen CLI authentication successful!\n\n');
        return true;
    } catch (e: any) {
        process.stdout.write(`\nError: ${e.message}\n`);
        return false;
    }
}

/**
 * Dispatch OAuth flow based on provider ID.
 */
async function performOauthFlow(providerId: string): Promise<boolean> {
    switch (providerId) {
        case 'gemini-cli':
        case 'antigravity':
            return performGeminiOauthFlow(providerId);
        case 'github-copilot':
            return performGitHubCopilotOauthFlow();
        case 'openai-codex':
            return performOpenAICodexOauthFlow();
        case 'qwen-cli':
            return performQwenCliOauthFlow();
        default:
            process.stdout.write(`Unknown OAuth provider: ${providerId}\n`);
            return false;
    }
}

interface AppProps {
    initialProviderId?: string;
    skipToModels?: boolean;
    onOauthRequest?: (providerId: string) => void;
}

const App: React.FC<AppProps> = ({ initialProviderId, skipToModels, onOauthRequest }) => {
    const [step, setStep] = useState<'select' | 'anthropic_submenu' | 'google_submenu' | 'input' | 'input_extra' | 'input_extra2' | 'models' | 'done'>(
        skipToModels ? 'models' : 'select'
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [googleIndex, setGoogleIndex] = useState(0);
    const [anthropicIndex, setAnthropicIndex] = useState(0);
    const [activeProviderId, setActiveProviderId] = useState(initialProviderId || '');
    const [apiKey, setApiKey] = useState('');
    const [extraField, setExtraField] = useState('');
    const [extraField2, setExtraField2] = useState('');

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
                } else if (provider.id === 'anthropic') {
                    setStep('anthropic_submenu');
                } else if (OAUTH_PROVIDERS.includes(provider.id)) {
                    // Signal to parent to handle OAuth outside Ink
                    onOauthRequest?.(provider.id);
                } else if (provider.id === 'cursor') {
                    // Cursor: skip API key input, auto-detect cursor-agent and go to models
                    setActiveProviderId('cursor');
                    const auth = loadAuth();
                    auth['cursor'] = { apiKey: 'cursor-auth', type: 'key' };
                    saveAuth(auth);
                    await prefetchModels('cursor');
                    moveToModelSelection('cursor');
                } else {
                    setActiveProviderId(provider.id);
                    prefetchModels(provider.id);
                    setStep('input');
                }
            }
        } else if (step === 'anthropic_submenu') {
            if (key.upArrow) setAnthropicIndex(Math.max(0, anthropicIndex - 1));
            if (key.downArrow) setAnthropicIndex(Math.min(ANTHROPIC_SUBMENU.length - 1, anthropicIndex + 1));
            if (key.return) {
                const sub = ANTHROPIC_SUBMENU[anthropicIndex];
                if (sub.id === 'back') {
                    setStep('select');
                } else {
                    setActiveProviderId(sub.id);
                    prefetchModels(sub.id);
                    setStep('input');
                }
            }
            if (key.escape) setStep('select');
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
            const MULTI_FIELD_PROVIDERS = ['azure', 'vertex', 'bedrock'];
            const ALLOW_EMPTY = ['ollama', 'litellm', 'bedrock'];
            if (key.return && (apiKey || ALLOW_EMPTY.includes(activeProviderId))) {
                if (MULTI_FIELD_PROVIDERS.includes(activeProviderId)) {
                    // Go to extra field input
                    setStep('input_extra');
                } else {
                    // Save credentials first so fetchProviderModels can use them
                    const auth = loadAuth();
                    if (activeProviderId === 'ollama') {
                        auth[activeProviderId] = {
                            apiKey: apiKey || 'http://localhost:11434/v1',
                            type: 'key',
                        };
                    } else if (activeProviderId === 'litellm') {
                        auth[activeProviderId] = {
                            apiKey: 'unused',
                            projectId: apiKey || 'http://localhost:4000/v1',
                            type: 'key',
                        };
                    } else {
                        auth[activeProviderId] = { 
                            apiKey, 
                            type: activeProviderId === 'anthropic-token' ? 'oauth' : 'key' 
                        };
                    }
                    saveAuth(auth);
                    // Now fetch models with credentials available
                    await prefetchModels(activeProviderId);
                    moveToModelSelection(activeProviderId);
                }
            } else if (key.backspace || key.delete) {
                setApiKey(apiKey.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setApiKey(apiKey + input);
            }
        } else if (step === 'input_extra') {
            if (key.return) {
                if (activeProviderId === 'bedrock') {
                    // Bedrock needs a third field (region)
                    setStep('input_extra2');
                } else {
                    // Azure: apiKey=API Key, extraField=Resource Name
                    // Vertex: apiKey=Project ID, extraField=Location
                    const auth = loadAuth();
                    if (activeProviderId === 'azure') {
                        auth[activeProviderId] = { apiKey, projectId: extraField, type: 'key' };
                    } else if (activeProviderId === 'vertex') {
                        auth[activeProviderId] = { apiKey: extraField || 'us-central1', projectId: apiKey, type: 'key' };
                    }
                    saveAuth(auth);
                    await prefetchModels(activeProviderId);
                    moveToModelSelection(activeProviderId);
                }
            } else if (key.backspace || key.delete) {
                setExtraField(extraField.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setExtraField(extraField + input);
            }
        } else if (step === 'input_extra2') {
            if (key.return) {
                // Bedrock: apiKey=Access Key ID, extraField=Secret Access Key, extraField2=Region
                const auth = loadAuth();
                auth[activeProviderId] = {
                    apiKey,
                    projectId: extraField,
                    refresh: extraField2 || 'us-east-1',
                    type: 'key',
                };
                saveAuth(auth);
                await prefetchModels(activeProviderId);
                moveToModelSelection(activeProviderId);
            } else if (key.backspace || key.delete) {
                setExtraField2(extraField2.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setExtraField2(extraField2 + input);
            }
        } else if (step === 'models') {
            if (isFetchingModels && !availableModels.length) return;
            if (key.upArrow) {
                setModelCursor(modelCursor === 0 ? availableModels.length : modelCursor - 1);
            }
            if (key.downArrow) {
                setModelCursor(modelCursor === availableModels.length ? 0 : modelCursor + 1);
            }
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

    const anthropicSubmenuList = useMemo(() => ANTHROPIC_SUBMENU.map((sub, index) => (
        <Box key={sub.id}>
            <Text color={index === anthropicIndex ? '#89B4FA' : '#6C7086'}>
                {index === anthropicIndex ? '●' : '○'}
            </Text>
            <Text color={index === anthropicIndex ? '#CDD6F4' : '#6C7086'} bold={index === anthropicIndex}>
                {' '}{sub.name}
            </Text>
        </Box>
    )), [anthropicIndex]);

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
            {step === 'anthropic_submenu' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Anthropic - Select authentication method:</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {anthropicSubmenuList}
                    </Box>
                    <Box marginTop={1}><Text color="#6C7086">(Esc to go back)</Text></Box>
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
                            <Text color="#CDD6F4">{
                                activeProviderId === 'anthropic-token' ? 'Setup Token' :
                                activeProviderId === 'ollama' ? 'Base URL' :
                                activeProviderId === 'litellm' ? 'Proxy URL' :
                                activeProviderId === 'vertex' ? 'Project ID' :
                                activeProviderId === 'bedrock' ? 'AWS Access Key ID' :
                                'API Key'
                            }: </Text>
                            {!apiKey && <Text color="#6C7086">
                                {activeProviderId === 'ollama' ? 'http://localhost:11434 (default, press Enter to skip)' :
                                 activeProviderId === 'litellm' ? 'http://localhost:4000 (default, press Enter to skip)' :
                                 activeProviderId === 'anthropic-token' ? 'Type or paste token here...' :
                                 activeProviderId === 'vertex' ? 'e.g. my-gcp-project' :
                                 activeProviderId === 'bedrock' ? 'AWS Access Key ID (or leave empty for default credentials)' :
                                 'Type or paste key here...'}
                            </Text>}
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
            {step === 'input_extra' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Configuring: <Text color="#89B4FA" bold>{activeProviderId}</Text> (step 2)</Text>
                    <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="#89B4FA" minHeight={3}>
                        <Box flexDirection="row">
                            <Text color="#CDD6F4">{
                                activeProviderId === 'azure' ? 'Resource Name' :
                                activeProviderId === 'vertex' ? 'Location' :
                                activeProviderId === 'bedrock' ? 'AWS Secret Access Key' :
                                'Extra'
                            }: </Text>
                            {!extraField && <Text color="#6C7086">
                                {activeProviderId === 'azure' ? 'e.g. my-openai-resource' :
                                 activeProviderId === 'vertex' ? 'us-central1 (default, press Enter to skip)' :
                                 activeProviderId === 'bedrock' ? 'AWS Secret Access Key' :
                                 '...'}
                            </Text>}
                            <Text color="#A6E3A1">{'*'.repeat(extraField.length)}</Text>
                            {showCursor && <Text backgroundColor="#CDD6F4" color="#1E1E2E"> </Text>}
                        </Box>
                    </Box>
                    <Box marginTop={1}><Text color="#6C7086">(Press Enter to continue)</Text></Box>
                </Box>
            )}
            {step === 'input_extra2' && (
                <Box flexDirection="column">
                    <Text color="#CDD6F4">Configuring: <Text color="#89B4FA" bold>{activeProviderId}</Text> (step 3)</Text>
                    <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="#89B4FA" minHeight={3}>
                        <Box flexDirection="row">
                            <Text color="#CDD6F4">AWS Region: </Text>
                            {!extraField2 && <Text color="#6C7086">us-east-1 (default, press Enter to skip)</Text>}
                            <Text color="#A6E3A1">{extraField2}</Text>
                            {showCursor && <Text backgroundColor="#CDD6F4" color="#1E1E2E"> </Text>}
                        </Box>
                    </Box>
                    <Box marginTop={1}><Text color="#6C7086">(Press Enter to continue)</Text></Box>
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
