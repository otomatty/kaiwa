// Google sign-in: OpenID Connect authorization code flow with PKCE, state and nonce.

import { LIMITS } from "../../shared/limits";
import { fromB64UrlText } from "./crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

/** Maps to a message on the sign-in page (`/login?error=<code>`). */
export class GoogleAuthError extends Error {
  constructor(public code: "google_failed" | "email_unverified") {
    super(code);
  }
}

export function googleConfigured(env: Env): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

function endpoints(env: Env) {
  // E2E builds point at a local stand-in for Google (e2e/google-oauth-mock.mjs).
  const base = env.GOOGLE_OAUTH_URL;
  return base ? { auth: `${base}/auth`, token: `${base}/token` } : { auth: AUTH_URL, token: TOKEN_URL };
}

export function authorizationUrl(
  env: Env,
  p: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(endpoints(env).auth);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nonce?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

/**
 * Exchanges the authorization code for an ID token and returns the verified profile.
 * The token comes straight from Google's token endpoint over TLS, authenticated with the
 * client secret, so its claims are checked but not its signature (OpenID Connect Core 3.1.3.7).
 */
export async function exchangeCode(
  env: Env,
  p: { code: string; redirectUri: string; codeVerifier: string; nonce: string },
): Promise<GoogleProfile> {
  let claims: IdTokenClaims;
  try {
    const res = await fetch(endpoints(env).token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: p.code,
        redirect_uri: p.redirectUri,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code_verifier: p.codeVerifier,
      }),
    });
    if (!res.ok) {
      console.warn(`Google token exchange failed: ${res.status} ${await res.text()}`);
      throw new GoogleAuthError("google_failed");
    }
    const { id_token } = (await res.json()) as { id_token?: unknown };
    const payload = typeof id_token === "string" ? id_token.split(".")[1] : undefined;
    if (!payload) throw new GoogleAuthError("google_failed");
    claims = JSON.parse(fromB64UrlText(payload)) as IdTokenClaims;
  } catch (err) {
    if (err instanceof GoogleAuthError) throw err;
    console.warn("Google token exchange failed:", err);
    throw new GoogleAuthError("google_failed");
  }

  const valid =
    ISSUERS.includes(claims.iss as string) &&
    claims.aud === env.GOOGLE_CLIENT_ID &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 > Date.now() &&
    claims.nonce === p.nonce &&
    typeof claims.sub === "string" &&
    claims.sub !== "" &&
    typeof claims.email === "string" &&
    claims.email !== "";
  if (!valid) {
    console.warn("Google ID token rejected (issuer, audience, expiry, nonce or subject)");
    throw new GoogleAuthError("google_failed");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new GoogleAuthError("email_unverified");
  }
  const email = (claims.email as string).trim().toLowerCase();
  const name = typeof claims.name === "string" ? claims.name.trim() : "";
  return {
    sub: claims.sub as string,
    email,
    name: [...(name || (email.split("@")[0] as string))].slice(0, LIMITS.displayName).join(""),
  };
}
