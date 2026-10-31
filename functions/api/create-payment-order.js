
export async function onRequestPost({ request, env }) {
  let savedOrderId = null;

  try {
    if (!env.DB || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return Response.json({ error: "Payment service is not configured." }, { status: 500 });
    }

    const data = await request.json();

    if (
      typeof data.customer_name !== "string" || !data.customer_name.trim() ||
      typeof data.mobile !== "string" || !/^[0-9+\-\s()]{8,20}$/.test(data.mobile) ||
      typeof data.address !== "string" || !data.address.trim() ||
      !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 50
    ) {
      return Response.json({ error: "Valid customer details and order items are required." }, { status: 400 });
    }

    const itemsMap = new Map();
    let total = 0;

    for (const item of data.items) {
      const id = Number(item.product_id);
      const qty = Number(item.quantity);

      if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
        return Response.json({ error: "Invalid product or quantity." }, { status: 400 });
      }

      const product = await env.DB.prepare(
        "SELECT id, name, price, stock FROM products WHERE id = ? AND active = 1"
      ).bind(id).first();

      if (!product) {
        return Response.json({ error: "Product not available." }, { status: 400 });
      }

      const price = Number(product.price);
      if (!Number.isSafeInteger(price) || price <= 0) {
        return Response.json({ error: "Invalid product price." }, { status: 400 });
      }

      const existing = itemsMap.get(id);
      const combinedQty = (existing?.qty || 0) + qty;

      if (combinedQty > 1000) {
        return Response.json({ error: "Invalid product quantity." }, { status: 400 });
      }

      if (Number(product.stock) < combinedQty) {
        return Response.json({ error: `Not enough stock for ${product.name}.` }, { status: 400 });
      }

      itemsMap.set(id, { product, qty: combinedQty });
    }

    const items = Array.from(itemsMap.values());

    for (const item of items) {
      total += Number(item.product.price) * item.qty;

      if (!Number.isSafeInteger(total) || total > 10000000) {
        return Response.json({ error: "Invalid order total." }, { status: 400 });
      }
    }

    if (total <= 0) {
      return Response.json({ error: "Invalid order total." }, { status: 400 });
    }

    const amountInPaise = total * 100;

    if (!Number.isSafeInteger(amountInPaise)) {
      return Response.json({ error: "Invalid payment amount." }, { status: 400 });
    }

    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const orderNumber = `ASH${Date.now()}${crypto.randomUUID().slice(0, 8)}`;

    const paymentResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        receipt: orderNumber
      })
    });

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok || !payment.id || payment.amount !== amountInPaise) {
      return Response.json({ error: "Razorpay could not create payment order." }, { status: 502 });
    }

    const insert = await env.DB.prepare(
      `INSERT INTO orders
      (order_number, customer_name, mobile, address, city, state, pincode,
       total_amount, payment_method, payment_status, order_status, razorpay_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Razorpay', 'Pending', 'Pending Payment', ?)`
    ).bind(
      orderNumber,
      data.customer_name.trim().slice(0, 150),
      data.mobile.trim(),
      data.address.trim().slice(0, 1000),
      typeof data.city === "string" ? data.city.trim().slice(0, 100) : "",
      typeof data.state === "string" ? data.state.trim().slice(0, 100) : "",
      typeof data.pincode === "string" ? data.pincode.trim().slice(0, 12) : "",
      total,
      payment.id
    ).run();

    savedOrderId = insert.meta?.last_row_id;

    if (!insert.success || !savedOrderId) {
      return Response.json({ error: "Could not save order." }, { status: 500 });
    }

    const statements = items.map(item =>
      env.DB.prepare(
        `INSERT INTO order_items
        (order_id, product_id, product_name, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?)`
      ).bind(
        savedOrderId,
        item.product.id,
        item.product.name,
        item.qty,
        item.product.price
      )
    );

    await env.DB.batch(statements);

    return Response.json({
      ok: true,
      order_id: payment.id,
      order_number: orderNumber,
      amount: payment.amount,
      currency: payment.currency,
      key_id: env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    if (savedOrderId) {
      try {
        await env.DB.prepare(
          "DELETE FROM orders WHERE id = ? AND payment_status = 'Pending'"
        ).bind(savedOrderId).run();
      } catch {
        // Leave the order for manual review if cleanup fails.
      }
    }

    return Response.json({ error: "Unable to create payment order." }, { status: 500 });
  }
}
