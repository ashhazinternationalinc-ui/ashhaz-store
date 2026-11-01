import { isAdmin, json, readJson } from "../_lib/auth.js";

const cleanText = (v, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const orderId = Number(new URL(request.url).searchParams.get("order_id"));
  if (!Number.isInteger(orderId) || orderId < 1) return json({ error: "Valid order ID required." }, 400);
  const { results = [] } = await env.DB.prepare(
    "SELECT id, order_id, action_type, status, amount, reason, details, external_id, created_at FROM order_actions WHERE order_id = ? ORDER BY id DESC"
  ).bind(orderId).all();
  return json({ actions: results });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Admin login required." }, 401);
  const data = await readJson(request);
  const orderId = Number(data?.order_id);
  const action = cleanText(data?.action, 30);
  const reason = cleanText(data?.reason, 500);
  const requestKey = cleanText(data?.request_key, 100);
  if (!Number.isInteger(orderId) || orderId < 1 || !requestKey) return json({ error: "Order and request key are required." }, 400);
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return json({ error: "Order not found." }, 404);
  const duplicate = await env.DB.prepare("SELECT id FROM order_actions WHERE request_key = ?").bind(requestKey).first();
  if (duplicate) return json({ error: "This action was already submitted. Refresh the order." }, 409);

  if (action === "archive" || action === "unarchive") {
    await env.DB.prepare("UPDATE orders SET archived_at = ? WHERE id = ?")
      .bind(action === "archive" ? new Date().toISOString() : null, orderId).run();
    await logAction(env, { orderId, action, status: "Completed", reason, requestKey, details: "Order archived state changed" });
    return json({ ok: true, message: action === "archive" ? "Order archived." : "Order restored to active list." });
  }

  if (action === "refund") {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(order.total_amount)) return json({ error: "Refund amount must be greater than zero and not exceed the order total." }, 400);
    if (order.payment_method === "Razorpay" && order.payment_status === "Paid") {
      if (!order.razorpay_payment_id || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: "Razorpay payment ID or Cloudflare Razorpay secrets are missing. No refund was sent." }, 400);
      const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
      const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(order.razorpay_payment_id)}/refund`, {
        method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.round(amount * 100), notes: { order_number: order.order_number, reason: reason || "Customer refund" } })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        await logAction(env, { orderId, action, status: "Failed", amount, reason, requestKey, details: result.error?.description || "Razorpay refund request failed" });
        return json({ error: result.error?.description || "Razorpay refund failed. Check Razorpay Dashboard." }, 400);
      }
      await logAction(env, { orderId, action, status: result.status || "processed", amount, reason, requestKey, externalId: result.id || "", details: JSON.stringify(result) });
      const prior = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM order_actions WHERE order_id = ? AND action_type = 'refund' AND status IN ('processed','pending','Manual Refund Required') AND request_key != ?").bind(orderId, requestKey).first();
      const refunded = Number(prior?.total || 0) + amount;
      await env.DB.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").bind(refunded >= Number(order.total_amount) ? "Refunded" : "Partially Refunded", orderId).run();
      return json({ ok: true, message: `Razorpay refund submitted. Refund ID: ${result.id || "created"}`, refund_id: result.id || "" });
    }
    // COD refunds are tracked but never represented as paid back automatically.
    await logAction(env, { orderId, action, status: "Manual Refund Required", amount, reason, requestKey, details: "Transfer refund to customer UPI/bank manually, then record completion in business records." });
    return json({ ok: true, manual: true, message: "COD/manual refund recorded as Manual Refund Required. Transfer money separately; this system has not sent money." });
  }

  if (action === "restock" || action === "exchange") {
    const productId = Number(data.product_id), quantity = Number(data.quantity);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return json({ error: "Select a valid product and quantity." }, 400);
    const product = await env.DB.prepare("SELECT id, name, stock, price FROM products WHERE id = ?").bind(productId).first();
    if (!product) return json({ error: "Product not found." }, 404);
    if (action === "exchange") {
      const result = await env.DB.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?").bind(quantity, productId, quantity).run();
      if (!result.meta?.changes) return json({ error: "Not enough replacement stock." }, 400);
      await logAction(env, { orderId, action, status: "Completed", amount: Number(product.price) * quantity, reason, requestKey, details: `Replacement dispatched/allocated: ${product.name} x ${quantity} (product ID ${productId}). Confirm courier dispatch separately.` });
      return json({ ok: true, message: `Exchange recorded. ${quantity} unit(s) deducted from ${product.name} stock.` });
    }
    await env.DB.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(quantity, productId).run();
    await logAction(env, { orderId, action, status: "Completed", reason, requestKey, details: `Returned goods inspected and restocked: ${product.name} x ${quantity} (product ID ${productId}).` });
    return json({ ok: true, message: `Returned stock added: ${product.name} x ${quantity}.` });
  }
  return json({ error: "Unsupported action." }, 400);
}

async function logAction(env, a) {
  await env.DB.prepare(
    "INSERT INTO order_actions (order_id, action_type, status, amount, reason, details, external_id, request_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(a.orderId, a.action, a.status, a.amount ?? null, a.reason || "", a.details || "", a.externalId || "", a.requestKey).run();
}
