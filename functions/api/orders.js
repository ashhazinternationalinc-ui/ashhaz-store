
// DELETE ORDER API
export async function onRequestDelete({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ error: "Admin login required." }, 401);
  }

  const id = Number(new URL(request.url).searchParams.get("id"));

  if (!Number.isInteger(id) || id < 1) {
    return json({ error: "Valid order ID is required." }, 400);
  }

  try {
    const order = await env.DB.prepare(
      "SELECT id, order_status, shipkia_order_id, shipkia_awb FROM orders WHERE id = ?"
    ).bind(id).first();

    if (!order) {
      return json({ error: "Order not found." }, 404);
    }

    if (
      ["Shipped", "Delivered"].includes(order.order_status) ||
      order.shipkia_order_id ||
      order.shipkia_awb
    ) {
      return json({
        error: "Shipped or courier-linked order cannot be deleted."
      }, 409);
    }

    const { results: items = [] } = await env.DB.prepare(
      `SELECT product_id, SUM(quantity) AS quantity
       FROM order_items
       WHERE order_id = ?
       GROUP BY product_id`
    ).bind(id).all();

    const statements = [];

    // Restore stock
    for (const item of items) {
      statements.push(
        env.DB.prepare(
          "UPDATE products SET stock = stock + ? WHERE id = ?"
        ).bind(Number(item.quantity), Number(item.product_id))
      );
    }

    // Delete dependent records first
    statements.push(
      env.DB.prepare(
        "DELETE FROM order_actions WHERE order_id = ?"
      ).bind(id)
    );

    statements.push(
      env.DB.prepare(
        "DELETE FROM order_items WHERE order_id = ?"
      ).bind(id)
    );

    // Delete order last
    statements.push(
      env.DB.prepare(
        "DELETE FROM orders WHERE id = ?"
      ).bind(id)
    );

    await env.DB.batch(statements);

    return json({
      ok: true,
      message: "Order deleted and stock restored."
    });

  } catch (error) {
    return json({
      error: "Order delete failed.",
      details: error.message
    }, 500);
  }
}

