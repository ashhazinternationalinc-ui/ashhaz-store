import { cookieHeader, json } from "../_lib/auth.js";
export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
}
