import Razorpay from "razorpay";
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils.js";

// Static on the class, not an instance method.
export function verifyWebhookSignature(rawBody, signature) {
  return Razorpay.validateWebhookSignature(
    rawBody,
    signature,
    process.env.RAZORPAY_WEBHOOK_SECRET
  );
}

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

// Full Route onboarding chain: create the linked account, register the
// individual stakeholder (KYC), request the "route" product configuration,
// then attach settlement/bank details to that product — this last call is
// what actually lets Razorpay pay the account out; without it the account
// exists but has nowhere to send money.
export async function createLinkedAccount(details) {
  const client = getRazorpayClient();

  const account = await client.accounts.create({
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

  await client.stakeholders.create(account.id, {
    name: details.contactName,
    email: details.email,
    phone: { primary: details.phone },
    kyc: { pan: details.pan },
  });

  const product = await client.products.requestProductConfiguration(account.id, {
    product_name: "route",
    tnc_accepted: true,
  });

  await client.products.edit(account.id, product.id, {
    settlements: {
      account_number: details.bankAccountNumber,
      ifsc_code: details.bankIfsc,
      beneficiary_name: details.legalBusinessName,
    },
    tnc_accepted: true,
  });

  return { account, productId: product.id };
}

// Real activation state — Route accounts don't activate the instant they're
// created; poll this rather than assuming "created" means "can be paid."
export async function checkAccountActivation(accountId, productId) {
  const client = getRazorpayClient();
  const [account, product] = await Promise.all([
    client.accounts.fetch(accountId),
    client.products.fetch(accountId, productId),
  ]);
  return {
    accountStatus: account.status,
    activationStatus: product.activation_status,
    requirements: product.requirements ?? [],
  };
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
