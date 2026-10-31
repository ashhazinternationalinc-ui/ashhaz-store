export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return Response.json({ error: "Payment service is not configured." }, { status: 500 });
    }

    const data = await request.json();

    if (
      !data.customer_name || !data.mobile || !data.address ||
      !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 50
    ) {
      return Response.json({ error: "Customer details and items are required." }, { status: 400 });
    }

    const items = [];
    let total = 0;

    for (const item of data.items) {
      const id = Number(item.product_id);
      const qty = Number(item.quantity);

      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
        return Response.json({ error: "Invalid product or quantity." }, { status: 400 });
      }

      const product = await env.DB.prepare(
        "SELECT id, name, price, stock FROM products WHERE id = ? AND active = 1"
      ).bind(id).first();

      if (!product) {
        return Response.json({ error: "Product not available." }, { status: 400 });
      }

      if (Number(product.stock) < qty) {
        return Response.json({ error: `Not enough stock for ${product.name}.` }, { status: 400 });
      }

      items.push({ product, qty });
      total += Number(product.price) * qty;
    }

    if (!Number.isSafeInteger(total) || total <= 0 || total > 10000000) {
      return Response.json({ error: "Invalid order total." }, { status: 400 });
    }

    const amountInPaise = total * 100;
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

    if (!paymentResponse.ok || !payment.id) {
      return Response.json({ error: "Razorpay could not create payment order." }, { status: 502 });
    }

    const insert = await env.DB.prepare(
      `INSERT INTO orders
      (order_number, customer_name, mobile, address, city, state, pincode,
       total_amount, payment_method, payment_status, order_status, razorpay_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Razorpay', 'Pending', 'Pending Payment', ?)`
    ).bind(
      orderNumber,
      String(data.customer_name).trim().slice(0, 150),
      String(data.mobile).trim().slice(0, 20),
      String(data.address).trim().slice(0, 1000),
      String(data.city || "").trim().slice(0, 100),
      String(data.state || "").trim().slice(0, 100),
      String(data.pincode || "").trim().slice(0, 12),
      total,
      payment.id
    ).run();

    const savedOrder = await env.DB.prepare(
      "SELECT id FROM orders WHERE order_number = ?"
    ).bind(orderNumber).first();

    if (!insert.success || !savedOrder) {
      return Response.json({ error: "Could not save order." }, { status: 500 });
    }

    for (const item of items) {
      await env.DB.prepare(
        `INSERT INTO order_items
        (order_id, product_id, product_name, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?)`
      ).bind(
        savedOrder.id,
        item.product.id,
        item.product.name,
        item.qty,
        item.product.price
      ).run();
    }

    return Response.json({
      order_id: payment.id,
      order_number: orderNumber,
      amount: payment.amount,
      currency: payment.currency,
      key_id: env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    return Response.json({ error: "Unable to create payment order." }, { status: 500 });
  }
}
