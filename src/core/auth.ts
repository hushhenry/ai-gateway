import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'ai-gateway');
const AUTH_FILE = 'auth.json';

export interface Credentials {
    apiKey?: string;
    type?: 'oauth' | 'key';
    refresh?: string;
    expires?: number;
    projectId?: string;
}

export function saveAuth(auth: Record<string, Credentials>, configPath?: string): void {
    const p = configPath || join(DEFAULT_CONFIG_DIR, AUTH_FILE);
    const dir = dirname(p);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(p, JSON.stringify(auth, null, 2), 'utf-8');
}

export function loadAuth(configPath?: string): Record<string, Credentials> {
    const pathsToCheck = [];
    if (configPath) pathsToCheck.push(configPath);
    pathsToCheck.push(join(DEFAULT_CONFIG_DIR, AUTH_FILE));

    for (const p of pathsToCheck) {
        if (existsSync(p)) {
            try {
                return JSON.parse(readFileSync(p, 'utf-8'));
            } catch (e) {
                console.warn(`Failed to parse auth file at ${p}`);
            }
        }
    }
    return {};
}

export async function getCredentials(providerId: string, configPath?: string): Promise<Credentials | null> {
    const auth = loadAuth(configPath);
    return auth[providerId] || null;
}
