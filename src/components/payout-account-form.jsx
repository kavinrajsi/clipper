"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

const STATUS_LABEL = {
  active: "Active",
  pending: "Pending",
  failed: "Failed — try again",
}

export function PayoutAccountForm({ user, payoutAccount, className, ...props }) {
  const [legalBusinessName, setLegalBusinessName] = useState(
    payoutAccount?.legal_business_name ?? ""
  )
  const [contactName, setContactName] = useState(
    payoutAccount?.contact_name ?? user.user_metadata?.full_name ?? ""
  )
  const [phone, setPhone] = useState(payoutAccount?.phone ?? "")
  const [pan, setPan] = useState(payoutAccount?.pan ?? "")
  const [addressStreet1, setAddressStreet1] = useState(payoutAccount?.address_street1 ?? "")
  const [addressCity, setAddressCity] = useState(payoutAccount?.address_city ?? "")
  const [addressState, setAddressState] = useState(payoutAccount?.address_state ?? "")
  const [addressPostalCode, setAddressPostalCode] = useState(
    payoutAccount?.address_postal_code ?? ""
  )
  const [bankAccountNumber, setBankAccountNumber] = useState(
    payoutAccount?.bank_account_number ?? ""
  )
  const [bankIfsc, setBankIfsc] = useState(payoutAccount?.bank_ifsc ?? "")
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(payoutAccount?.status ?? null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const response = await fetch("/api/payments/payout-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    })

    const result = await response.json().catch(() => null)
    setLoading(false)

    if (!response.ok) {
      setError(result?.error ?? "Something went wrong. Try again.")
      setStatus("failed")
      return
    }

    setStatus("active")
    setSuccess(true)
  }

  return (
    <Card className={cn(className)} {...props}>
      <CardHeader>
        <CardTitle>Payout Account</CardTitle>
        <CardDescription>
          Required before you can receive campaign payouts. Bank details and PAN are sent to
          Razorpay to verify and set up your linked account.
        </CardDescription>
        {status && (
          <Badge variant={status === "active" ? "default" : "outline"} className="w-fit">
            {STATUS_LABEL[status] ?? status}
          </Badge>
        )}
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription>Payout account set up.</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="legal-business-name">Legal name</FieldLabel>
                <Input
                  id="legal-business-name"
                  value={legalBusinessName}
                  onChange={(event) => setLegalBusinessName(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-name">Contact name</FieldLabel>
                <Input
                  id="contact-name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="phone">Phone</FieldLabel>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pan">PAN</FieldLabel>
                <Input
                  id="pan"
                  value={pan}
                  onChange={(event) => setPan(event.target.value.toUpperCase())}
                  required
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="address-street1">Address</FieldLabel>
              <Input
                id="address-street1"
                value={addressStreet1}
                onChange={(event) => setAddressStreet1(event.target.value)}
                required
              />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor="address-city">City</FieldLabel>
                <Input
                  id="address-city"
                  value={addressCity}
                  onChange={(event) => setAddressCity(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="address-state">State</FieldLabel>
                <Input
                  id="address-state"
                  value={addressState}
                  onChange={(event) => setAddressState(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="address-postal-code">Postal code</FieldLabel>
                <Input
                  id="address-postal-code"
                  value={addressPostalCode}
                  onChange={(event) => setAddressPostalCode(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="bank-account-number">Bank account number</FieldLabel>
                <Input
                  id="bank-account-number"
                  value={bankAccountNumber}
                  onChange={(event) => setBankAccountNumber(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="bank-ifsc">IFSC</FieldLabel>
                <Input
                  id="bank-ifsc"
                  value={bankIfsc}
                  onChange={(event) => setBankIfsc(event.target.value.toUpperCase())}
                  required
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={loading}>
            {loading && <Spinner />}
            Save payout account
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
