/**
 * Qwen CLI OAuth flow (Device Code + PKCE)
 * Adapted from pi-mono/packages/coding-agent/examples/extensions/custom-provider-qwen-cli/index.ts
 */

const DEVICE_CODE_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/device/code';
const TOKEN_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/token';
const CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const SCOPE = 'openid profile email model.completion';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const POLL_INTERVAL_MS = 2000;

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const verifier = btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return { verifier, challenge };
}

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    resource_url?: string;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Login cancelled'));
            return;
        }
        const timeout = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Login cancelled'));
        }, { once: true });
    });
}

async function startDeviceFlow(): Promise<{ deviceCode: DeviceCodeResponse; verifier: string }> {
    const { verifier, challenge } = await generatePKCE();

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });

    const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
    };
    const requestId = globalThis.crypto?.randomUUID?.();
    if (requestId) headers['x-request-id'] = requestId;

    const response = await fetch(DEVICE_CODE_ENDPOINT, {
        method: 'POST',
        headers,
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Device code request failed: ${response.status} ${text}`);
    }

    const data = await response.json() as DeviceCodeResponse;
    if (!data.device_code || !data.user_code || !data.verification_uri) {
        throw new Error('Invalid device code response');
    }

    return { deviceCode: data, verifier };
}

async function pollForToken(
    deviceCode: string,
    verifier: string,
    intervalSeconds: number | undefined,
    expiresIn: number,
    signal?: AbortSignal,
): Promise<TokenResponse> {
    const deadline = Date.now() + expiresIn * 1000;
    const resolvedInterval = typeof intervalSeconds === 'number' && intervalSeconds > 0
        ? intervalSeconds
        : POLL_INTERVAL_MS / 1000;
    let intervalMs = Math.max(1000, Math.floor(resolvedInterval * 1000));

    while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error('Login cancelled');

        const body = new URLSearchParams({
            grant_type: GRANT_TYPE,
            client_id: CLIENT_ID,
            device_code: deviceCode,
            code_verifier: verifier,
        });

        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: body.toString(),
        });

        const responseText = await response.text();
        let data: (TokenResponse & { error?: string; error_description?: string }) | null = null;
        if (responseText) {
            try { data = JSON.parse(responseText); } catch { data = null; }
        }

        if (data?.access_token) {
            return data;
        }

        const error = data?.error;
        if (error) {
            if (error === 'authorization_pending') {
                await abortableSleep(intervalMs, signal);
                continue;
            }
            if (error === 'slow_down') {
                intervalMs = Math.min(intervalMs + 5000, 10000);
                await abortableSleep(intervalMs, signal);
                continue;
            }
            if (error === 'expired_token') {
                throw new Error('Device code expired. Please restart authentication.');
            }
            if (error === 'access_denied') {
                throw new Error('Authorization denied by user.');
            }
            throw new Error(`Token request failed: ${error} - ${data?.error_description || ''}`);
        }

        if (!response.ok) {
            throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
        }

        await abortableSleep(intervalMs, signal);
    }

    throw new Error('Authentication timed out.');
}

function getBaseUrl(resourceUrl?: string): string {
    if (!resourceUrl) return DEFAULT_BASE_URL;
    let url = resourceUrl.startsWith('http') ? resourceUrl : `https://${resourceUrl}`;
    if (!url.endsWith('/v1')) url = `${url}/v1`;
    return url;
}

/**
 * Refresh a Qwen CLI token.
 */
export async function refreshQwenCliToken(
    refreshToken: string,
): Promise<{ apiKey: string; refresh: string; expires: number; projectId: string }> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }

    const data = await response.json() as TokenResponse;
    if (!data.access_token) {
        throw new Error('Token refresh failed: no access token');
    }

    const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

    return {
        apiKey: data.access_token,
        refresh: data.refresh_token || refreshToken,
        expires: expiresAt,
        projectId: getBaseUrl(data.resource_url),
    };
}

/**
 * Full Qwen CLI login flow: device code + PKCE → poll → credentials.
 */
export async function loginQwenCli(): Promise<{
    userCode: string;
    verificationUri: string;
    poll: () => Promise<{ apiKey: string; refresh: string; expires: number; projectId: string }>;
}> {
    const { deviceCode, verifier } = await startDeviceFlow();

    const authUrl = deviceCode.verification_uri_complete || deviceCode.verification_uri;
    const userCode = deviceCode.user_code;

    return {
        userCode,
        verificationUri: authUrl,
        poll: async () => {
            const tokenResponse = await pollForToken(
                deviceCode.device_code,
                verifier,
                deviceCode.interval,
                deviceCode.expires_in,
            );

            const expiresAt = Date.now() + tokenResponse.expires_in * 1000 - 5 * 60 * 1000;

            return {
                apiKey: tokenResponse.access_token,
                refresh: tokenResponse.refresh_token || '',
                expires: expiresAt,
                projectId: getBaseUrl(tokenResponse.resource_url),
            };
        },
    };
}
