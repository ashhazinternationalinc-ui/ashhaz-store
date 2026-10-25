import { isAdmin, json, readJson } from "../_lib/auth.js";

export async function onRequestGet({ env }) {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, sku, name, description, price, stock, image_url, category, active, created_at FROM products WHERE active = 1 ORDER BY id DESC"
  ).all();
  return json({ products: results });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const p = await readJson(request);
  const error = validateProduct(p);
  if (error) return json({ error }, 400);
  try {
    const result = await env.DB.prepare(
      "INSERT INTO products (sku, name, description, price, stock, image_url, category, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    ).bind(clean(p.sku) || null, clean(p.name), clean(p.description), Number(p.price), Number(p.stock), clean(p.image_url), clean(p.category)).run();
    return json({ ok: true, id: result.meta?.last_row_id }, 201);
  } catch (e) {
    return json({ error: "Product could not be saved. Check whether SKU is unique." }, 400);
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const p = await readJson(request);
  const error = validateProduct(p);
  if (error || !Number.isInteger(Number(p?.id)) || Number(p.id) < 1) return json({ error: error || "Valid product id required." }, 400);
  try {
    await env.DB.prepare(
      "UPDATE products SET sku = ?, name = ?, description = ?, price = ?, stock = ?, image_url = ?, category = ?, active = ? WHERE id = ?"
    ).bind(clean(p.sku) || null, clean(p.name), clean(p.description), Number(p.price), Number(p.stock), clean(p.image_url), clean(p.category), p.active === 0 ? 0 : 1, Number(p.id)).run();
    return json({ ok: true });
  } catch {
    return json({ error: "Product could not be updated. Check SKU uniqueness." }, 400);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return json({ error: "Valid product id required." }, 400);
  // Soft delete preserves historical order references.
  await env.DB.prepare("UPDATE products SET active = 0 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
function clean(v) { return typeof v === "string" ? v.trim().slice(0, 4000) : ""; }
function validateProduct(p) {
  if (!p || typeof p.name !== "string" || !p.name.trim()) return "Product name is required.";
  if (!Number.isFinite(Number(p.price)) || Number(p.price) < 0 || Number(p.price) > 100000000) return "Valid price required.";
  if (!Number.isInteger(Number(p.stock)) || Number(p.stock) < 0 || Number(p.stock) > 10000000) return "Valid stock quantity required.";
  return null;
}
