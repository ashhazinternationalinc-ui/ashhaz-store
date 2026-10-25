const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(b64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}
export async function makeSession(env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("Admin secrets are not configured correctly.");
  }
  const payload = { role: "admin", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = toBase64Url(await hmac(env.SESSION_SECRET, body));
  return `${body}.${sig}`;
}
export async function isAdmin(request, env) {
  try {
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return false;
    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)ashhaz_admin=([^;]+)/);
    if (!match) return false;
    const [body, sig, extra] = match[1].split(".");
    if (!body || !sig || extra) return false;
    const expected = await hmac(env.SESSION_SECRET, body);
    const actual = fromBase64Url(sig);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    if (diff !== 0) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    return payload.role === "admin" && payload.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
export function cookieHeader(value, maxAge) {
  return `ashhaz_admin=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
