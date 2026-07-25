const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

// Fetches an order for the campaign, opens Razorpay Checkout, verifies the
// resulting payment server-side, then reports success/failure. Used from both
// the campaign-creation flow and the retry button on an unfunded campaign card.
export async function openCampaignCheckout(campaignId, { onSuccess, onError }) {
  try {
    await loadRazorpayScript();

    const fundResponse = await fetch(`/api/payments/campaigns/${campaignId}/fund`, {
      method: "POST",
    });
    const fundResult = await fundResponse.json().catch(() => null);

    if (!fundResponse.ok) {
      onError(fundResult?.error ?? "Couldn't start payment. Try again.");
      return;
    }

    const { orderId, amount, keyId, campaignTitle } = fundResult;

    const razorpay = new window.Razorpay({
      key: keyId,
      amount,
      currency: "INR",
      order_id: orderId,
      name: campaignTitle,
      description: "Campaign funding",
      handler: async (response) => {
        const verifyResponse = await fetch(`/api/payments/campaigns/${campaignId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });

        if (!verifyResponse.ok) {
          const verifyResult = await verifyResponse.json().catch(() => null);
          onError(verifyResult?.error ?? "Payment verification failed.");
          return;
        }

        onSuccess();
      },
      modal: {
        ondismiss: () => onError("Payment cancelled."),
      },
    });

    razorpay.on("payment.failed", () => onError("Payment failed. Try again."));
    razorpay.open();
  } catch (err) {
    onError(err.message ?? "Couldn't start payment. Try again.");
  }
}
