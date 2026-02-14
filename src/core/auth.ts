import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'ai-gateway');
const PI_CONFIG_DIR = join(homedir(), '.config', 'pi');
const AUTH_FILE = 'auth.json';

export interface Credentials {
    apiKey?: string;
    type?: 'oauth' | 'key';
    // Add other OAuth fields here as needed
}

export function loadAuth(configPath?: string): Record<string, Credentials> {
    const pathsToCheck = [];
    if (configPath) pathsToCheck.push(configPath);
    pathsToCheck.push(join(DEFAULT_CONFIG_DIR, AUTH_FILE));
    pathsToCheck.push(join(PI_CONFIG_DIR, AUTH_FILE));

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
