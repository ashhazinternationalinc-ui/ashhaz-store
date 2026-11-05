import { isAdmin, json, readJson } from "../_lib/auth.js";

const ORDER_STATUSES = new Set([
  "New", "Processing", "Shipped", "Delivered", "Cancelled", "Returned", "Pending Payment"
]);

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const { results: rows = [] } = await env.DB.prepare(
    `SELECT id, order_number, customer_name, mobile, address, city, state, pincode,
            total_amount, payment_method, payment_status, order_status,
            razorpay_order_id, razorpay_payment_id, created_at, archived_at,
            shipkia_order_id, shipkia_awb, courier_partner, courier_status
     FROM orders ORDER BY id DESC LIMIT 500`
  ).all();

  if (!rows.length) return json({ orders: [] });

  const ids = rows.map(o => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: items = [] } = await env.DB.prepare(
    `SELECT order_id, product_id, product_name, quantity, unit_price
     FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id DESC`
  ).bind(...ids).all();

  const byOrder = new Map();
  for (const item of items) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
    byOrder.get(item.order_id).push(item);
  }
  return json({ orders: rows.map(o => ({ ...o, items: byOrder.get(o.id) || [] })) });
}

export async function onRequestPatch({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const data = await readJson(request);
  const id = Number(data?.id);
  const status = String(data?.order_status || "");
  if (!Number.isInteger(id) || id < 1 || !ORDER_STATUSES.has(status)) {
    return json({ error: "Valid order ID and order status are required." }, 400);
  }

  const result = await env.DB.prepare(
    "UPDATE orders SET order_status = ? WHERE id = ?"
  ).bind(status, id).run();

  if (!result.meta?.changes) return json({ error: "Order not found or status unchanged." }, 404);
  return json({ ok: true, message: "Order status updated." });
}

export async function onRequestPost({ request, env }) {
  const data = await readJson(request);
  if (!data || typeof data.customer_name !== "string" || !data.customer_name.trim() ||
      typeof data.mobile !== "string" || !/^[0-9+\-\s()]{8,20}$/.test(data.mobile) ||
      typeof data.address !== "string" || !data.address.trim() ||
      !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 50) {
    return json({ error: "Customer name, valid mobile, address and order items are required." }, 400);
  }
  const items = [];
  let total = 0;
  for (const item of data.items) {
    const id = Number(item.product_id);
    const qty = Number(item.quantity);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
      return json({ error: "Invalid order item." }, 400);
    }
    const product = await env.DB.prepare("SELECT id, name, price, stock FROM products WHERE id = ? AND active = 1").bind(id).first();
    if (!product) return json({ error: "One of the products is unavailable." }, 400);
    if (product.stock < qty) return json({ error: `Not enough stock for ${product.name}.` }, 400);
    items.push({ product, qty });
    total += Number(product.price) * qty;
    if (!Number.isSafeInteger(total) || total > 1000000000) return json({ error: "Order total is too large." }, 400);
  }
  const orderNumber = "ASH" + Date.now().toString(36).toUpperCase() + crypto.randomUUID().slice(0, 6).toUpperCase();
  try {
    const insert = await env.DB.prepare(
      "INSERT INTO orders (order_number, customer_name, mobile, address, city, state, pincode, total_amount, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COD', 'Pending', 'New')"
    ).bind(orderNumber, data.customer_name.trim().slice(0, 150), data.mobile.trim(), data.address.trim().slice(0, 1000),
      typeof data.city === "string" ? data.city.trim().slice(0, 100) : "",
      typeof data.state === "string" ? data.state.trim().slice(0, 100) : "",
      typeof data.pincode === "string" ? data.pincode.trim().slice(0, 12) : "", total).run();
    const orderId = insert.meta.last_row_id;
    for (const item of items) {
      await env.DB.prepare("INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)")
        .bind(orderId, item.product.id, item.product.name, item.qty, item.product.price).run();
      await env.DB.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
        .bind(item.qty, item.product.id, item.qty).run();
    }
    return json({ ok: true, order_number: orderNumber, total_amount: total }, 201);
  } catch {
    return json({ error: "Order could not be saved. Please retry after checking stock." }, 500);
  }
}
