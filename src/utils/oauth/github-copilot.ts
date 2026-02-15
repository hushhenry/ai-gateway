/**
 * GitHub Copilot OAuth flow (Device Code Flow)
 * Adapted from pi-mono/packages/ai/src/utils/oauth/github-copilot.ts
 */

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("SXYxLmI1MDdhMDhjODdlY2ZlOTg=");

const COPILOT_HEADERS = {
    'User-Agent': 'GitHubCopilotChat/0.35.0',
    'Editor-Version': 'vscode/1.107.0',
    'Editor-Plugin-Version': 'copilot-chat/0.35.0',
    'Copilot-Integration-Id': 'vscode-chat',
} as const;

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
    expires_in: number;
}

function getUrls(domain: string) {
    return {
        deviceCodeUrl: `https://${domain}/login/device/code`,
        accessTokenUrl: `https://${domain}/login/oauth/access_token`,
        copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
    };
}

/**
 * Parse the proxy-ep from a Copilot token and convert to API base URL.
 * Token format: tid=...;exp=...;proxy-ep=proxy.individual.githubcopilot.com;...
 * Returns API URL like https://api.individual.githubcopilot.com
 */
export function getBaseUrlFromToken(token: string): string | null {
    const match = token.match(/proxy-ep=([^;]+)/);
    if (!match) return null;
    const proxyHost = match[1];
    const apiHost = proxyHost.replace(/^proxy\./, 'api.');
    return `https://${apiHost}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return response.json();
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

/**
 * Start the GitHub device code flow.
 */
export async function getGitHubCopilotAuthUrl(domain: string = 'github.com'): Promise<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
    expiresIn: number;
}> {
    const urls = getUrls(domain);
    const data = await fetchJson(urls.deviceCodeUrl, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'GitHubCopilotChat/0.35.0',
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            scope: 'read:user',
        }),
    }) as DeviceCodeResponse;

    if (!data.device_code || !data.user_code || !data.verification_uri) {
        throw new Error('Invalid device code response');
    }

    return {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        deviceCode: data.device_code,
        interval: data.interval,
        expiresIn: data.expires_in,
    };
}

/**
 * Poll for the GitHub access token after the user has authorized the device.
 */
export async function pollForGitHubCopilotToken(
    deviceCode: string,
    interval: number,
    expiresIn: number,
    domain: string = 'github.com',
    signal?: AbortSignal,
): Promise<string> {
    const urls = getUrls(domain);
    const deadline = Date.now() + expiresIn * 1000;
    let intervalMs = Math.max(1000, Math.floor(interval * 1000));

    while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error('Login cancelled');

        const raw = await fetchJson(urls.accessTokenUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.35.0',
            },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                device_code: deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
        }) as Record<string, unknown>;

        if (typeof raw.access_token === 'string') {
            return raw.access_token;
        }

        if (typeof raw.error === 'string') {
            if (raw.error === 'authorization_pending') {
                await abortableSleep(intervalMs, signal);
                continue;
            }
            if (raw.error === 'slow_down') {
                intervalMs += 5000;
                await abortableSleep(intervalMs, signal);
                continue;
            }
            throw new Error(`Device flow failed: ${raw.error}`);
        }

        await abortableSleep(intervalMs, signal);
    }

    throw new Error('Device flow timed out');
}

/**
 * Exchange a GitHub access token for a Copilot session token.
 * Returns { token, expiresAt, baseUrl }.
 */
export async function refreshGitHubCopilotToken(
    githubAccessToken: string,
    domain: string = 'github.com',
): Promise<{ token: string; expiresAt: number; baseUrl: string }> {
    const urls = getUrls(domain);

    const raw = await fetchJson(urls.copilotTokenUrl, {
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${githubAccessToken}`,
            ...COPILOT_HEADERS,
        },
    }) as Record<string, unknown>;

    const token = raw.token;
    const expiresAt = raw.expires_at;

    if (typeof token !== 'string' || typeof expiresAt !== 'number') {
        throw new Error('Invalid Copilot token response');
    }

    const baseUrl = getBaseUrlFromToken(token) || `https://api.individual.githubcopilot.com`;

    return {
        token,
        expiresAt: expiresAt * 1000 - 5 * 60 * 1000,
        baseUrl,
    };
}

/**
 * Full login flow: device code → poll → exchange for Copilot token.
 * Returns credentials suitable for saving to auth.json.
 */
export async function loginGitHubCopilot(domain: string = 'github.com'): Promise<{
    auth: DeviceCodeResponse & { userCode: string; verificationUri: string };
    poll: () => Promise<{ apiKey: string; refresh: string; projectId: string; expires: number }>;
}> {
    const deviceInfo = await getGitHubCopilotAuthUrl(domain);

    return {
        auth: {
            ...deviceInfo,
            device_code: deviceInfo.deviceCode,
            user_code: deviceInfo.userCode,
            verification_uri: deviceInfo.verificationUri,
            interval: deviceInfo.interval,
            expires_in: deviceInfo.expiresIn,
        },
        poll: async () => {
            const githubToken = await pollForGitHubCopilotToken(
                deviceInfo.deviceCode,
                deviceInfo.interval,
                deviceInfo.expiresIn,
                domain,
            );
            const copilot = await refreshGitHubCopilotToken(githubToken, domain);
            return {
                apiKey: copilot.token,
                refresh: githubToken,
                projectId: copilot.baseUrl,
                expires: copilot.expiresAt,
            };
        },
    };
}
