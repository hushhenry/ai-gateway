import { generatePKCE } from './pkce.js';
import { saveAuth, loadAuth } from '../../core/auth.js';

const _p1 = "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVq";
const _p2 = "LmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t";
const _s1 = "R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=";

const CLIENT_ID = atob(_p1 + _p2);
const CLIENT_SECRET = atob(_s1);

const REDIRECT_URI_AUTHCODE = "https://codeassist.google.com/authcode";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function getGeminiAuthUrl() {
    const { verifier, challenge } = await generatePKCE();
    const state = Math.random().toString(36).substring(2, 15);
    
    const authParams = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI_AUTHCODE,
        scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: state,
        access_type: "offline",
        prompt: "consent",
    });
    
    return {
        url: `${AUTH_URL}?${authParams.toString()}`,
        verifier
    };
}

export async function exchangeGeminiCode(code: string, verifier: string) {
    const tokenResponse = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code.trim(),
            grant_type: "authorization_code",
            redirect_uri: REDIRECT_URI_AUTHCODE,
            code_verifier: verifier,
        }),
    });

    if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    }

    const tokenData = await tokenResponse.json() as any;
    const auth = loadAuth();
    auth['google'] = {
        apiKey: tokenData.access_token,
        type: 'oauth',
        refresh: tokenData.refresh_token,
        expires: Date.now() + (tokenData.expires_in * 1000),
    };
    saveAuth(auth);
}
