import Razorpay from "razorpay";
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils.js";

export function getRazorpayClient() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// amount is in rupees; Razorpay wants the smallest currency subunit (paise).
export async function createOrder(amount, receipt) {
  const client = getRazorpayClient();
  return client.orders.create({
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt,
  });
}

export function verifyPaymentSignature(orderId, paymentId, signature) {
  return validatePaymentVerification(
    { order_id: orderId, payment_id: paymentId },
    signature,
    process.env.RAZORPAY_KEY_SECRET
  );
}

export async function createLinkedAccount(details) {
  const client = getRazorpayClient();
  return client.accounts.create({
    email: details.email,
    phone: details.phone,
    type: "route",
    business_type: "individual",
    legal_business_name: details.legalBusinessName,
    contact_name: details.contactName,
    profile: {
      category: "others",
      subcategory: "other",
      addresses: {
        registered: {
          street1: details.addressStreet1,
          street2: "",
          city: details.addressCity,
          state: details.addressState,
          postal_code: details.addressPostalCode,
          country: "IN",
        },
      },
    },
    legal_info: {
      pan: details.pan,
    },
  });
}

// Held indefinitely (no on_hold_until) until releaseTransferHold is called.
export async function createHeldTransfer(paymentId, accountId, amount) {
  const client = getRazorpayClient();
  const result = await client.payments.transfer(paymentId, {
    transfers: [
      {
        account: accountId,
        amount: Math.round(amount * 100),
        currency: "INR",
        on_hold: true,
      },
    ],
  });
  return result.items[0];
}

export async function releaseTransferHold(transferId) {
  const client = getRazorpayClient();
  return client.transfers.edit(transferId, { on_hold: false });
}
