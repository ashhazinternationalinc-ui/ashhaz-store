export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.RAZORPAY_KEY_SECRET) {
      return Response.json({ error: "Payment service not configured." }, { status: 500 });
    }

    const data = await request.json();
    const orderId = String(data.razorpay_order_id || "");
    const paymentId = String(data.razorpay_payment_id || "");
    const signature = String(data.razorpay_signature || "");

    if (!orderId || !paymentId || !signature) {
      return Response.json({ error: "Payment details are missing." }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.RAZORPAY_KEY_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(orderId + "|" + paymentId)
    );

    const expected = Array.from(new Uint8Array(signed))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    if (expected !== signature.toLowerCase()) {
      return Response.json({ error: "Payment verification failed." }, { status: 400 });
    }

    const order = await env.DB.prepare(
      "SELECT id, payment_status FROM orders WHERE razorpay_order_id = ?"
    ).bind(orderId).first();

    if (!order) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    if (order.payment_status === "Paid") {
      return Response.json({ ok: true, message: "Payment already verified." });
    }

    const updated = await env.DB.prepare(
      "UPDATE orders SET payment_status = 'Paid', order_status = 'New', razorpay_payment_id = ? WHERE id = ? AND razorpay_order_id = ? AND payment_status = 'Pending' RETURNING id"
    ).bind(paymentId, order.id, orderId).first();

    if (!updated) {
      return Response.json({ error: "Order could not be updated." }, { status: 409 });
    }

    const items = await env.DB.prepare(
      "SELECT product_id, quantity FROM order_items WHERE order_id = ?"
    ).bind(order.id).all();

    for (const item of items.results || []) {
      const result = await env.DB.prepare(
        "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?"
      ).bind(item.quantity, item.product_id, item.quantity).run();

      if (!result.success || result.meta.changes !== 1) {
        return Response.json({
          error: "Payment received, but stock update needs attention.",
          order_id: order.id
        }, { status: 409 });
      }
    }

    return Response.json({ ok: true, message: "Payment verified successfully." });

  } catch (error) {
    return Response.json({ error: "Payment verification error." }, { status: 500 });
  }
}
