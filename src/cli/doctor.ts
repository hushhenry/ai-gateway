/**
 * ai-gateway doctor — validate all configured providers
 *
 * For each provider+model, tests:
 *   1. Text (non-streaming + streaming)
 *   2. Tool use (non-streaming + streaming)
 *
 * Supports both /v1/chat/completions and /v1/messages endpoints.
 */

import { loadAuth } from '../core/auth.js';

const TOOL_OPENAI = [{
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

const TOOL_ANTHROPIC = [{
    name: 'get_weather',
    description: 'Get the current weather in a given location',
    input_schema: {
        type: 'object',
        properties: { location: { type: 'string', description: 'City name' } },
        required: ['location'],
    },
}];

interface Check {
    name: string;
    ok: boolean;
    ms: number;
    err?: string;
}

function parseSSE(raw: string): string[] {
    return raw.split(/\n\n/).flatMap(block =>
        block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6))
    ).filter(Boolean);
}

// ─── /v1/chat/completions checks ──────────────────────────────────────────────

async function chatText(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: false, max_tokens: 50, messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }] }),
            signal: AbortSignal.timeout(30000),
        });
        const j: any = await r.json();
        const ok = r.ok && !!j.choices?.[0]?.message?.content;
        return { name: '/chat/completions text', ok, ms: Date.now() - t0, err: ok ? undefined : `${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e: any) { return { name: '/chat/completions text', ok: false, ms: Date.now() - t0, err: e.message }; }
}

async function chatTextStream(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true, max_tokens: 50, messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }] }),
            signal: AbortSignal.timeout(30000),
        });
        const raw = await r.text();
        const lines = parseSSE(raw);
        let hasContent = false;
        for (const l of lines) {
            if (l === '[DONE]') continue;
            try { const c = JSON.parse(l); if (c.choices?.[0]?.delta?.content) hasContent = true; } catch {}
        }
        const ok = r.ok && hasContent;
        return { name: '/chat/completions text stream', ok, ms: Date.now() - t0, err: ok ? undefined : `${r.status}: no content delta` };
    } catch (e: any) { return { name: '/chat/completions text stream', ok: false, ms: Date.now() - t0, err: e.message }; }
}

async function chatTool(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: false, max_tokens: 200, messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }], tools: TOOL_OPENAI }),
            signal: AbortSignal.timeout(30000),
        });
        const j: any = await r.json();
        const tc = j.choices?.[0]?.message?.tool_calls?.[0];
        const ok = r.ok && tc?.function?.name === 'get_weather' && typeof tc?.function?.arguments === 'string';
        return { name: '/chat/completions tool', ok, ms: Date.now() - t0, err: ok ? undefined : `${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e: any) { return { name: '/chat/completions tool', ok: false, ms: Date.now() - t0, err: e.message }; }
}

async function chatToolStream(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true, max_tokens: 200, messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }], tools: TOOL_OPENAI }),
            signal: AbortSignal.timeout(30000),
        });
        const raw = await r.text();
        const lines = parseSSE(raw);
        let name = '', args = '';
        for (const l of lines) {
            if (l === '[DONE]') continue;
            try {
                const c = JSON.parse(l);
                const tc = c.choices?.[0]?.delta?.tool_calls?.[0];
                if (tc?.function?.name) name = tc.function.name;
                if (tc?.function?.arguments) args += tc.function.arguments;
            } catch {}
        }
        const ok = r.ok && name === 'get_weather' && args.length > 0;
        let argsValid = false;
        try { JSON.parse(args); argsValid = true; } catch {}
        return { name: '/chat/completions tool stream', ok: ok && argsValid, ms: Date.now() - t0, err: (ok && argsValid) ? undefined : `name=${name}, args=${args.slice(0, 100)}` };
    } catch (e: any) { return { name: '/chat/completions tool stream', ok: false, ms: Date.now() - t0, err: e.message }; }
}

// ─── /v1/messages checks ──────────────────────────────────────────────────────

async function msgText(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: false, max_tokens: 50, messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }] }),
            signal: AbortSignal.timeout(30000),
        });
        const j: any = await r.json();
        const ok = r.ok && j.content?.some((b: any) => b.type === 'text');
        return { name: '/messages text', ok, ms: Date.now() - t0, err: ok ? undefined : `${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e: any) { return { name: '/messages text', ok: false, ms: Date.now() - t0, err: e.message }; }
}

async function msgTextStream(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true, max_tokens: 50, messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }] }),
            signal: AbortSignal.timeout(30000),
        });
        const raw = await r.text();
        const lines = parseSSE(raw);
        let hasTextDelta = false;
        for (const l of lines) {
            try { const e = JSON.parse(l); if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') hasTextDelta = true; } catch {}
        }
        const ok = r.ok && hasTextDelta;
        return { name: '/messages text stream', ok, ms: Date.now() - t0, err: ok ? undefined : `${r.status}: no text_delta` };
    } catch (e: any) { return { name: '/messages text stream', ok: false, ms: Date.now() - t0, err: e.message }; }
}

async function msgTool(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: false, max_tokens: 200, messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }], tools: TOOL_ANTHROPIC }),
            signal: AbortSignal.timeout(30000),
        });
        const j: any = await r.json();
        const tb = j.content?.find((b: any) => b.type === 'tool_use');
        const ok = r.ok && tb?.name === 'get_weather' && typeof tb?.input === 'object' && j.stop_reason === 'tool_use';
        return { name: '/messages tool', ok, ms: Date.now() - t0, err: ok ? undefined : `${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e: any) { return { name: '/messages tool', ok: false, ms: Date.now() - t0, err: e.message }; }
}

async function msgToolStream(base: string, model: string): Promise<Check> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${base}/v1/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true, max_tokens: 200, messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }], tools: TOOL_ANTHROPIC }),
            signal: AbortSignal.timeout(30000),
        });
        const raw = await r.text();
        const lines = parseSSE(raw);
        let hasToolStart = false, hasInputDelta = false, stopReason = '';
        for (const l of lines) {
            try {
                const e = JSON.parse(l);
                if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') hasToolStart = true;
                if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') hasInputDelta = true;
                if (e.type === 'message_delta') stopReason = e.delta?.stop_reason || '';
            } catch {}
        }
        const ok = r.ok && hasToolStart && hasInputDelta && stopReason === 'tool_use';
        return { name: '/messages tool stream', ok, ms: Date.now() - t0, err: ok ? undefined : `toolStart=${hasToolStart} inputDelta=${hasInputDelta} stop=${stopReason}` };
    } catch (e: any) { return { name: '/messages tool stream', ok: false, ms: Date.now() - t0, err: e.message }; }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

function icon(ok: boolean): string { return ok ? '✅' : '❌'; }

export async function runDoctor(options: {
    port?: number;
    models?: string[];  // e.g. ['anthropic-token/claude-haiku-4-5-20251001', 'gemini-cli/gemini-3-flash-preview']
    endpoint?: 'chat' | 'messages' | 'both';
    verbose?: boolean;
}) {
    const port = options.port || 8192;
    const base = `http://localhost:${port}`;
    const endpoint = options.endpoint || 'chat';
    const verbose = options.verbose || false;

    // Gateway reachable?
    try {
        const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) throw new Error(`status ${r.status}`);
    } catch {
        console.error(`\n❌ Gateway not reachable at ${base}`);
        console.error(`   Start it with: ai-gateway serve --port ${port}\n`);
        process.exit(1);
    }

    // Build test targets: array of { provider, model (full "provider/modelId") }
    let targets: Array<{ provider: string; model: string }>;

    if (options.models?.length) {
        // User specified exact models
        targets = options.models.map(m => {
            const slash = m.indexOf('/');
            if (slash === -1) {
                console.error(`\n⚠️  Invalid model format "${m}". Use: provider/model\n`);
                process.exit(1);
            }
            return { provider: m.substring(0, slash), model: m };
        });
    } else {
        // Default: first enabled model per configured provider
        const auth = loadAuth();
        const all = Object.entries(auth).filter(([_, c]) => c.enabledModels?.length);
        if (!all.length) { console.error('\n⚠️  No providers configured. Run: ai-gateway login\n'); process.exit(1); }
        targets = all.map(([pid, creds]) => ({
            provider: pid,
            model: `${pid}/${creds.enabledModels![0]}`,
        }));
    }

    const providerCount = new Set(targets.map(t => t.provider)).size;
    console.log(`\n🩺 AI Gateway Doctor — ${targets.length} model(s) across ${providerCount} provider(s)\n`);
    console.log(`   Gateway: ${base}`);
    console.log(`   Endpoint: ${endpoint === 'both' ? 'chat + messages' : endpoint}\n`);

    let pass = 0, fail = 0;

    for (const { provider: pid, model } of targets) {
        console.log(`── ${model} ──`);

        const checks: Check[] = [];

        if (endpoint === 'chat' || endpoint === 'both') {
            checks.push(await chatText(base, model));
            checks.push(await chatTextStream(base, model));
            checks.push(await chatTool(base, model));
            checks.push(await chatToolStream(base, model));
        }

        if (endpoint === 'messages' || endpoint === 'both') {
            checks.push(await msgText(base, model));
            checks.push(await msgTextStream(base, model));
            checks.push(await msgTool(base, model));
            checks.push(await msgToolStream(base, model));
        }

        for (const c of checks) {
            console.log(`  ${icon(c.ok)} ${c.name}  (${c.ms}ms)`);
            if (!c.ok && verbose && c.err) console.log(`     ${c.err}`);
            if (c.ok) pass++; else fail++;
        }

        console.log('');
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ✅ ${pass} passed   ❌ ${fail} failed`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    if (fail > 0) process.exit(1);
}
