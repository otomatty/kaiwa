// A local stand-in for Google's OAuth endpoints so E2E tests can sign in without a real account.
// The app talks to it when built with E2E_GOOGLE_OAUTH_URL (see vite.config.ts / playwright.config.ts).
//
//   GET  /auth   account chooser: enter an email and a name, then "続行" (or "キャンセル")
//   POST /token  exchanges the code for an unsigned ID token, checking client, redirect URI and PKCE
//
// Usage: node e2e/google-oauth-mock.mjs [port]
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4175);
const FLOW_PARAMS = ["client_id", "redirect_uri", "state", "nonce", "code_challenge"];

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function redirect(res, url) {
  res.writeHead(302, { Location: url.toString() }).end();
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function accountChooser(params) {
  const hidden = FLOW_PARAMS.map(
    (k) => `<input type="hidden" name="${k}" value="${escapeHtml(params.get(k) ?? "")}">`,
  ).join("");
  const cancel = new URL(params.get("redirect_uri") ?? "");
  cancel.searchParams.set("error", "access_denied");
  cancel.searchParams.set("state", params.get("state") ?? "");
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Google（E2E モック）</title>
<body style="font-family: sans-serif; max-width: 360px; margin: 48px auto">
<h1>アカウントの選択</h1>
<form method="get" action="/approve">${hidden}
  <p><label>メールアドレス <input name="email" type="email" required></label></p>
  <p><label>名前 <input name="name"></label></p>
  <button type="submit">続行</button>
</form>
<p><a href="${escapeHtml(cancel.toString())}">キャンセル</a></p>
</body></html>`;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const q = url.searchParams;

  if (url.pathname === "/health") return json(res, 200, { ok: true });

  if (req.method === "GET" && url.pathname === "/auth") {
    const missing = FLOW_PARAMS.filter((k) => !q.get(k));
    if (
      missing.length > 0 ||
      q.get("response_type") !== "code" ||
      q.get("code_challenge_method") !== "S256"
    ) {
      return json(res, 400, { error: "invalid_request", missing });
    }
    if (!q.get("scope")?.split(" ").includes("openid")) return json(res, 400, { error: "invalid_scope" });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(accountChooser(q));
    return;
  }

  if (req.method === "GET" && url.pathname === "/approve") {
    // The code carries everything the token endpoint needs, so the mock keeps no state.
    const code = b64url(
      Object.fromEntries([...FLOW_PARAMS, "email", "name"].map((k) => [k, q.get(k) ?? ""])),
    );
    const back = new URL(q.get("redirect_uri") ?? "");
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state") ?? "");
    return redirect(res, back);
  }

  if (req.method === "POST" && url.pathname === "/token") {
    const form = new URLSearchParams(await readBody(req));
    let grant;
    try {
      grant = JSON.parse(Buffer.from(form.get("code") ?? "", "base64url").toString());
    } catch {
      return json(res, 400, { error: "invalid_grant" });
    }
    const verifier = form.get("code_verifier") ?? "";
    const ok =
      form.get("grant_type") === "authorization_code" &&
      form.get("client_id") === grant.client_id &&
      !!form.get("client_secret") &&
      form.get("redirect_uri") === grant.redirect_uri &&
      createHash("sha256").update(verifier).digest("base64url") === grant.code_challenge;
    if (!ok) return json(res, 400, { error: "invalid_grant" });
    const now = Math.floor(Date.now() / 1000);
    const email = grant.email.toLowerCase();
    const claims = {
      iss: "https://accounts.google.com",
      aud: grant.client_id,
      // Stable per email, like a real Google account ID.
      sub: createHash("sha256").update(email).digest("hex").slice(0, 21),
      email,
      email_verified: true,
      name: grant.name || undefined,
      nonce: grant.nonce,
      iat: now,
      exp: now + 3600,
    };
    return json(res, 200, {
      access_token: "mock-access-token",
      token_type: "Bearer",
      expires_in: 3599,
      scope: "openid email profile",
      id_token: `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.`,
    });
  }

  json(res, 404, { error: "not_found" });
}).listen(port, () => console.info(`Google OAuth mock listening on http://localhost:${port}`));
