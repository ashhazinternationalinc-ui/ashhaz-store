
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return Response.json({ error: "Payment service not configured." }, { status: 500 });
    }

    const data = await request.json();
    const orderId = String(data.razorpay_order_id || "");
    const paymentId = String(data.razorpay_payment_id || "");
    const signature = String(data.razorpay_signature || "");

    if (!orderId || !paymentId || !signature) {
      return Response.json({ error: "Payment details are missing." }, { status: 400 });
    }

    // Verify Razorpay signature
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

    // Find our saved order
    const order = await env.DB.prepare(
      "SELECT id, total_amount, payment_status FROM orders WHERE razorpay_order_id = ?"
    ).bind(orderId).first();

    if (!order) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    if (order.payment_status === "Paid") {
      return Response.json({ ok: true, message: "Payment already verified." });
    }

    if (order.payment_status !== "Pending") {
      return Response.json({ error: "Order is not awaiting payment." }, { status: 409 });
    }

    // Confirm payment directly with Razorpay
    const credentials = btoa(
      `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
    );

    const paymentResponse = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: { Authorization: `Basic ${credentials}` }
      }
    );

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      return Response.json({ error: "Could not confirm payment with Razorpay." }, { status: 502 });
    }

    if (
      payment.order_id !== orderId ||
      payment.amount !== Math.round(Number(order.total_amount) * 100) ||
      payment.currency !== "INR" ||
      payment.status !== "captured"
    ) {
      return Response.json({
        error: "Payment is not captured or payment details do not match."
      }, { status: 409 });
    }

    // Update order, deduct stock and mark Paid in one transaction.
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE orders
        SET payment_status = 'Verifying',
            razorpay_payment_id = ?
        WHERE id = ?
          AND razorpay_order_id = ?
          AND payment_status = 'Pending'
          AND EXISTS (
            SELECT 1 FROM order_items WHERE order_id = orders.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = orders.id
              AND (p.id IS NULL OR p.stock < oi.quantity)
          )
        RETURNING id
      `).bind(paymentId, order.id, orderId),

      env.DB.prepare(`
        UPDATE products
        SET stock = stock - (
          SELECT oi.quantity
          FROM order_items oi
          WHERE oi.order_id = ?
            AND oi.product_id = products.id
        )
        WHERE id IN (
          SELECT product_id FROM order_items WHERE order_id = ?
        )
          AND EXISTS (
            SELECT 1 FROM orders
            WHERE id = ?
              AND payment_status = 'Verifying'
              AND razorpay_payment_id = ?
          )
      `).bind(order.id, order.id, order.id, paymentId),

      env.DB.prepare(`
        UPDATE orders
        SET payment_status = 'Paid',
            order_status = 'New'
        WHERE id = ?
          AND payment_status = 'Verifying'
          AND razorpay_payment_id = ?
      `).bind(order.id, paymentId)
    ]);

    if (!results[0]?.results?.length) {
      return Response.json({
        error: "Payment received, but stock is unavailable or order could not be updated. Please contact support.",
        order_id: order.id
      }, { status: 409 });
    }

    return Response.json({
      ok: true,
      message: "Payment verified successfully.",
      order_id: order.id
    });

  } catch (error) {
    return Response.json({
      error: "Payment verification error."
    }, { status: 500 });
  }
}
