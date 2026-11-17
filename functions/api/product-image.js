import { isAdmin, json } from "../_lib/auth.js";

const OWNER = "ashhazinternationalinc-ui";
const REPO = "ashhaz-store";
const BRANCH = "main";

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required. Please sign in again." }, 401);
  if (!env.GITHUB_TOKEN) return json({ error: "One-time setup is incomplete: add the GITHUB_TOKEN secret in Cloudflare Pages settings." }, 503);

  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  const mime = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!mime[type]) return json({ error: "Only JPG, PNG and WEBP images are supported." }, 415);

  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > 4 * 1024 * 1024) return json({ error: "Image must be between 1 byte and 4 MB." }, 413);

  // Use a unique filename so each upload is a new GitHub content object.
  const filename = `product-${crypto.randomUUID()}.${mime[type]}`;
  const path = `product-images/${filename}`;
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const content = btoa(binary);

  const gh = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "ASHHAZ-Store-Admin"
    },
    body: JSON.stringify({ message: `Upload product image ${filename}`, content, branch: BRANCH })
  });

  const result = await gh.json().catch(() => ({}));
  if (!gh.ok) {
    const message = gh.status === 401 || gh.status === 403
      ? "GitHub upload permission is missing. Check the Cloudflare GITHUB_TOKEN secret and repository Contents: Read and write permission."
      : (result.message || `GitHub image upload failed (${gh.status}).`);
    return json({ error: message }, 502);
  }

  const imageUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;
  return json({ ok: true, image_url: imageUrl, path }, 201);
}
