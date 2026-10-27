
export async function onRequestPost({ request, env }) {
  try {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return Response.json(
        { error: "Razorpay keys are not configured." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return Response.json(
        { error: "Invalid payment amount." },
        { status: 400 }
      );
    }

    // Amount must be sent in rupees; Razorpay accepts paise.
    const amountInPaise = Math.round(amount * 100);

    const credentials = btoa(
      `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
    );

    const razorpayResponse = await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: "INR",
          receipt: `ashhaz_${Date.now()}`
        })
      }
    );

    const result = await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      return Response.json(
        { error: "Razorpay could not create the payment order." },
        { status: 502 }
      );
    }

    return Response.json({
      order_id: result.id,
      amount: result.amount,
      currency: result.currency,
      key_id: env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    return Response.json(
      { error: "Unable to create payment order." },
      { status: 400 }
    );
  }
}
