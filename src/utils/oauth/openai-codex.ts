/**
 * OpenAI Codex (ChatGPT OAuth) flow
 * Adapted from pi-mono/packages/ai/src/utils/oauth/openai-codex.ts
 *
 * Uses Authorization Code flow with PKCE and a local callback server.
 * Node.js only (uses node:crypto and node:http).
 */

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { generatePKCE } from './pkce.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

const SUCCESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Authentication successful</title></head>
<body><p>Authentication successful. Return to your terminal to continue.</p></body></html>`;

function createState(): string {
    return randomBytes(16).toString('hex');
}

function decodeJwt(token: string): Record<string, any> | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const decoded = atob(parts[1]!);
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

function getAccountId(accessToken: string): string | null {
    const payload = decodeJwt(accessToken);
    const auth = payload?.[JWT_CLAIM_PATH];
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : null;
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
    const value = input.trim();
    if (!value) return {};
    try {
        const url = new URL(value);
        return {
            code: url.searchParams.get('code') ?? undefined,
            state: url.searchParams.get('state') ?? undefined,
        };
    } catch {}
    if (value.includes('#')) {
        const [code, state] = value.split('#', 2);
        return { code, state };
    }
    if (value.includes('code=')) {
        const params = new URLSearchParams(value);
        return {
            code: params.get('code') ?? undefined,
            state: params.get('state') ?? undefined,
        };
    }
    return { code: value };
}

async function exchangeAuthorizationCode(
    code: string,
    verifier: string,
): Promise<{ access: string; refresh: string; expires: number } | null> {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: REDIRECT_URI,
        }),
    });

    if (!response.ok) return null;

    const json = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
    };

    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
        return null;
    }

    return {
        access: json.access_token,
        refresh: json.refresh_token,
        expires: Date.now() + json.expires_in * 1000,
    };
}

/**
 * Refresh an OpenAI Codex token using a refresh token.
 */
export async function refreshOpenAICodexToken(
    refreshToken: string,
): Promise<{ apiKey: string; refresh: string; expires: number; projectId: string }> {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CLIENT_ID,
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to refresh OpenAI Codex token');
    }

    const json = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
    };

    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
        throw new Error('Invalid token refresh response');
    }

    const accountId = getAccountId(json.access_token);
    if (!accountId) {
        throw new Error('Failed to extract accountId from token');
    }

    return {
        apiKey: json.access_token,
        refresh: json.refresh_token,
        expires: Date.now() + json.expires_in * 1000,
        projectId: accountId,
    };
}

/**
 * Start the OpenAI Codex authorization flow.
 * Returns the auth URL and a helper to complete the exchange.
 */
export async function createOpenAICodexAuthFlow(): Promise<{
    url: string;
    state: string;
    verifier: string;
}> {
    const { verifier, challenge } = await generatePKCE();
    const state = createState();

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('originator', 'openclaw');

    return { url: url.toString(), state, verifier };
}

interface OAuthServerInfo {
    close: () => void;
    cancelWait: () => void;
    waitForCode: () => Promise<{ code: string } | null>;
}

function startLocalOAuthServer(state: string): Promise<OAuthServerInfo> {
    let lastCode: string | null = null;
    let cancelled = false;

    const server = http.createServer((req, res) => {
        try {
            const url = new URL(req.url || '', 'http://localhost');
            if (url.pathname !== '/auth/callback') {
                res.statusCode = 404;
                res.end('Not found');
                return;
            }
            if (url.searchParams.get('state') !== state) {
                res.statusCode = 400;
                res.end('State mismatch');
                return;
            }
            const code = url.searchParams.get('code');
            if (!code) {
                res.statusCode = 400;
                res.end('Missing authorization code');
                return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(SUCCESS_HTML);
            lastCode = code;
        } catch {
            res.statusCode = 500;
            res.end('Internal error');
        }
    });

    return new Promise((resolve) => {
        server.listen(1455, '127.0.0.1', () => {
            resolve({
                close: () => server.close(),
                cancelWait: () => { cancelled = true; },
                waitForCode: async () => {
                    const sleep = () => new Promise((r) => setTimeout(r, 100));
                    for (let i = 0; i < 600; i++) {
                        if (lastCode) return { code: lastCode };
                        if (cancelled) return null;
                        await sleep();
                    }
                    return null;
                },
            });
        }).on('error', () => {
            resolve({
                close: () => { try { server.close(); } catch {} },
                cancelWait: () => {},
                waitForCode: async () => null,
            });
        });
    });
}

/**
 * Perform the complete OpenAI Codex login flow.
 * 1. Opens browser for auth
 * 2. Starts local server to receive callback
 * 3. Falls back to manual paste if callback fails
 * 4. Returns credentials for auth.json
 */
export async function loginOpenAICodex(options: {
    onAuth: (url: string) => void;
    onPrompt: (message: string) => Promise<string>;
}): Promise<{ apiKey: string; refresh: string; expires: number; projectId: string }> {
    const { url, state, verifier } = await createOpenAICodexAuthFlow();
    const server = await startLocalOAuthServer(state);

    options.onAuth(url);

    let code: string | undefined;
    try {
        const result = await server.waitForCode();
        if (result?.code) {
            code = result.code;
        }

        if (!code) {
            const input = await options.onPrompt('Paste the authorization code (or full redirect URL):');
            const parsed = parseAuthorizationInput(input);
            if (parsed.state && parsed.state !== state) {
                throw new Error('State mismatch');
            }
            code = parsed.code;
        }

        if (!code) {
            throw new Error('Missing authorization code');
        }

        const tokenResult = await exchangeAuthorizationCode(code, verifier);
        if (!tokenResult) {
            throw new Error('Token exchange failed');
        }

        const accountId = getAccountId(tokenResult.access);
        if (!accountId) {
            throw new Error('Failed to extract accountId from token');
        }

        return {
            apiKey: tokenResult.access,
            refresh: tokenResult.refresh,
            expires: tokenResult.expires,
            projectId: accountId,
        };
    } finally {
        server.close();
    }
}
