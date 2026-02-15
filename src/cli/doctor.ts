/**
 * ai-gateway doctor — validate all configured providers
 * 
 * For each provider+model:
 *   1. Basic connectivity: send a simple prompt, expect text back
 *   2. Tool use: send a prompt with a tool, expect a tool_call back
 * 
 * Tests both /v1/chat/completions and /v1/messages endpoints.
 */

import { loadAuth } from '../core/auth.js';

const TOOL_DEF_OPENAI = [{
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        parameters: {
            type: 'object',
            properties: { location: { type: 'string', description: 'City name' } },
            required: ['location'],
        },
    },
}];

const TOOL_DEF_ANTHROPIC = [{
    name: 'get_weather',
    description: 'Get the current weather in a given location',
    input_schema: {
        type: 'object',
        properties: { location: { type: 'string', description: 'City name' } },
        required: ['location'],
    },
}];

interface TestResult {
    provider: string;
    model: string;
    test: string;
    status: 'pass' | 'fail' | 'skip';
    detail?: string;
    durationMs?: number;
}

async function testChatCompletions(
    baseUrl: string,
    model: string,
    stream: boolean,
): Promise<{ textOk: boolean; toolOk: boolean; textErr?: string; toolErr?: string; textMs?: number; toolMs?: number }> {
    const result = { textOk: false, toolOk: false, textErr: '', toolErr: '', textMs: 0, toolMs: 0 };

    // Text test
    try {
        const t0 = Date.now();
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, stream,
                messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
                max_tokens: 50,
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (stream) {
            const text = await res.text();
            result.textOk = res.ok && text.includes('data:');
            if (!result.textOk) result.textErr = `status=${res.status}, body=${text.slice(0, 200)}`;
        } else {
            const json: any = await res.json();
            result.textOk = res.ok && !!json.choices?.[0]?.message?.content;
            if (!result.textOk) result.textErr = `status=${res.status}, body=${JSON.stringify(json).slice(0, 200)}`;
        }
        result.textMs = Date.now() - t0;
    } catch (e: any) {
        result.textErr = e.message;
    }

    // Tool test
    try {
        const t0 = Date.now();
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, stream: false,
                messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
                tools: TOOL_DEF_OPENAI,
                max_tokens: 200,
            }),
            signal: AbortSignal.timeout(30000),
        });
        const json: any = await res.json();
        const tc = json.choices?.[0]?.message?.tool_calls?.[0];
        result.toolOk = res.ok && tc?.function?.name === 'get_weather' && typeof tc?.function?.arguments === 'string';
        if (!result.toolOk) result.toolErr = `status=${res.status}, body=${JSON.stringify(json).slice(0, 200)}`;
        result.toolMs = Date.now() - t0;
    } catch (e: any) {
        result.toolErr = e.message;
    }

    return result;
}

async function testMessages(
    baseUrl: string,
    model: string,
    stream: boolean,
): Promise<{ textOk: boolean; toolOk: boolean; textErr?: string; toolErr?: string; textMs?: number; toolMs?: number }> {
    const result = { textOk: false, toolOk: false, textErr: '', toolErr: '', textMs: 0, toolMs: 0 };

    // Text test
    try {
        const t0 = Date.now();
        const res = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, stream,
                max_tokens: 50,
                messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (stream) {
            const text = await res.text();
            result.textOk = res.ok && text.includes('event:');
            if (!result.textOk) result.textErr = `status=${res.status}, body=${text.slice(0, 200)}`;
        } else {
            const json: any = await res.json();
            const hasText = json.content?.some((b: any) => b.type === 'text');
            result.textOk = res.ok && hasText;
            if (!result.textOk) result.textErr = `status=${res.status}, body=${JSON.stringify(json).slice(0, 200)}`;
        }
        result.textMs = Date.now() - t0;
    } catch (e: any) {
        result.textErr = e.message;
    }

    // Tool test
    try {
        const t0 = Date.now();
        const res = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, stream: false,
                max_tokens: 200,
                messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
                tools: TOOL_DEF_ANTHROPIC,
            }),
            signal: AbortSignal.timeout(30000),
        });
        const json: any = await res.json();
        const toolBlock = json.content?.find((b: any) => b.type === 'tool_use');
        result.toolOk = res.ok && toolBlock?.name === 'get_weather' && typeof toolBlock?.input === 'object';
        if (!result.toolOk) result.toolErr = `status=${res.status}, body=${JSON.stringify(json).slice(0, 200)}`;
        result.toolMs = Date.now() - t0;
    } catch (e: any) {
        result.toolErr = e.message;
    }

    return result;
}

function icon(status: 'pass' | 'fail' | 'skip'): string {
    switch (status) {
        case 'pass': return '✅';
        case 'fail': return '❌';
        case 'skip': return '⏭️';
    }
}

export async function runDoctor(options: {
    port?: number;
    provider?: string;
    endpoint?: 'chat' | 'messages' | 'both';
    verbose?: boolean;
}) {
    const port = options.port || 8192;
    const baseUrl = `http://localhost:${port}`;
    const endpoint = options.endpoint || 'chat';
    const verbose = options.verbose || false;

    // Check if gateway is running
    try {
        const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (e: any) {
        console.error(`\n❌ Gateway not reachable at ${baseUrl}`);
        console.error(`   Start it with: ai-gateway serve --port ${port}\n`);
        process.exit(1);
    }

    // Load configured providers
    const auth = loadAuth();
    const providers = Object.entries(auth).filter(([_, creds]) => {
        return creds.enabledModels && creds.enabledModels.length > 0;
    });

    if (providers.length === 0) {
        console.error('\n⚠️  No providers configured with enabled models.');
        console.error('   Run: ai-gateway login\n');
        process.exit(1);
    }

    // Filter by provider if specified
    const filtered = options.provider
        ? providers.filter(([id]) => id === options.provider)
        : providers;

    if (filtered.length === 0) {
        console.error(`\n⚠️  Provider "${options.provider}" not found in configuration.`);
        console.error(`   Available: ${providers.map(([id]) => id).join(', ')}\n`);
        process.exit(1);
    }

    console.log(`\n🩺 AI Gateway Doctor — testing ${filtered.length} provider(s)\n`);
    console.log(`   Gateway: ${baseUrl}`);
    console.log(`   Endpoint(s): ${endpoint === 'both' ? '/v1/chat/completions + /v1/messages' : endpoint === 'messages' ? '/v1/messages' : '/v1/chat/completions'}\n`);

    const results: TestResult[] = [];
    let totalPass = 0, totalFail = 0;

    for (const [providerId, creds] of filtered) {
        // Pick first enabled model for testing
        const model = `${providerId}/${creds.enabledModels![0]}`;
        console.log(`── ${providerId} (${model}) ──`);

        if (endpoint === 'chat' || endpoint === 'both') {
            // Chat Completions - text
            const chat = await testChatCompletions(baseUrl, model, false);
            const textStatus = chat.textOk ? 'pass' : 'fail';
            const toolStatus = chat.toolOk ? 'pass' : 'fail';
            console.log(`  ${icon(textStatus)} /chat/completions text  (${chat.textMs}ms)`);
            if (!chat.textOk && verbose) console.log(`     ${chat.textErr}`);
            console.log(`  ${icon(toolStatus)} /chat/completions tools (${chat.toolMs}ms)`);
            if (!chat.toolOk && verbose) console.log(`     ${chat.toolErr}`);

            results.push({ provider: providerId, model, test: 'chat-text', status: textStatus, detail: chat.textErr, durationMs: chat.textMs });
            results.push({ provider: providerId, model, test: 'chat-tools', status: toolStatus, detail: chat.toolErr, durationMs: chat.toolMs });
            if (chat.textOk) totalPass++; else totalFail++;
            if (chat.toolOk) totalPass++; else totalFail++;
        }

        if (endpoint === 'messages' || endpoint === 'both') {
            const msg = await testMessages(baseUrl, model, false);
            const textStatus = msg.textOk ? 'pass' : 'fail';
            const toolStatus = msg.toolOk ? 'pass' : 'fail';
            console.log(`  ${icon(textStatus)} /messages text  (${msg.textMs}ms)`);
            if (!msg.textOk && verbose) console.log(`     ${msg.textErr}`);
            console.log(`  ${icon(toolStatus)} /messages tools (${msg.toolMs}ms)`);
            if (!msg.toolOk && verbose) console.log(`     ${msg.toolErr}`);

            results.push({ provider: providerId, model, test: 'msg-text', status: textStatus, detail: msg.textErr, durationMs: msg.textMs });
            results.push({ provider: providerId, model, test: 'msg-tools', status: toolStatus, detail: msg.toolErr, durationMs: msg.toolMs });
            if (msg.textOk) totalPass++; else totalFail++;
            if (msg.toolOk) totalPass++; else totalFail++;
        }

        console.log('');
    }

    // Summary
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ✅ ${totalPass} passed   ❌ ${totalFail} failed`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    if (totalFail > 0) process.exit(1);
}
