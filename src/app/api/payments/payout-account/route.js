import { NextResponse } from "next/server";
import { createLinkedAccount } from "@/lib/razorpay";
import { createClient } from "@/lib/supabase/server";

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const {
    legalBusinessName,
    contactName,
    phone,
    pan,
    addressStreet1,
    addressCity,
    addressState,
    addressPostalCode,
    bankAccountNumber,
    bankIfsc,
  } = body;

  const baseRow = {
    user_id: user.id,
    legal_business_name: legalBusinessName,
    contact_name: contactName,
    phone,
    pan,
    address_street1: addressStreet1,
    address_city: addressCity,
    address_state: addressState,
    address_postal_code: addressPostalCode,
    bank_account_number: bankAccountNumber,
    bank_ifsc: bankIfsc,
    updated_at: new Date().toISOString(),
  };

  try {
    const account = await createLinkedAccount({
      email: user.email,
      contactName,
      phone,
      legalBusinessName,
      pan,
      addressStreet1,
      addressCity,
      addressState,
      addressPostalCode,
    });

    const { error: upsertError } = await supabase.from("clipper_payout_accounts").upsert({
      ...baseRow,
      razorpay_account_id: account.id,
      status: "active",
    });

    if (upsertError) throw upsertError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Razorpay linked account creation failed", err);

    await supabase.from("clipper_payout_accounts").upsert({
      ...baseRow,
      status: "failed",
    });

    return NextResponse.json(
      { error: "Payout account setup failed. Check your details and try again." },
      { status: 502 }
    );
  }
}
