import { makeSession, cookieHeader, json, readJson } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return json({ error: "Admin secrets are not configured." }, 500);
  }
  const data = await readJson(request);
  if (!data || typeof data.password !== "string" || data.password.length > 256) {
    return json({ error: "Invalid request." }, 400);
  }
  // Exact comparison. Use a strong unique password and configure rate limiting at Cloudflare.
  if (data.password !== env.ADMIN_PASSWORD) {
    return json({ error: "Incorrect password." }, 401);
  }
  const token = await makeSession(env);
  return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(token, 60 * 60 * 8) });
}
