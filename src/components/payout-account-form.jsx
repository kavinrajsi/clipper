"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"

const STATUS_LABEL = {
  active: "Active",
  pending: "Pending",
  under_review: "Under review",
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
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(payoutAccount?.status ?? null)
  const [checkingStatus, setCheckingStatus] = useState(false)

  async function checkStatus() {
    setCheckingStatus(true)
    const response = await fetch("/api/payments/payout-account/check-status", { method: "POST" })
    const result = await response.json().catch(() => null)
    setCheckingStatus(false)

    if (response.ok && result?.status) {
      setStatus(result.status)
    }
  }

  useEffect(() => {
    if (status !== "pending" && status !== "under_review") return

    // Deliberately not calling checkStatus() here: its first statement is
    // setCheckingStatus(true), which is a synchronous setState inside an effect
    // (react-hooks/set-state-in-effect). The spinner belongs to the "Refresh
    // status" button anyway — this mount check is meant to be invisible.
    let cancelled = false
    fetch("/api/payments/payout-account/check-status", { method: "POST" })
      .then((response) => response.json().catch(() => null))
      .then((result) => {
        if (cancelled || !result?.status) return
        setStatus(result.status)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
    // Only check once on mount for the initial status — the "Refresh status"
    // button covers manual re-checks after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
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

    setStatus("pending")
    toast.success("Payout account set up.")
  }

  return (
    <form onSubmit={handleSubmit} className={cn(className)} {...props}>
      <FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {status && (
          <div className="flex items-center gap-2">
            <Badge variant={status === "active" ? "default" : "outline"} className="w-fit">
              {STATUS_LABEL[status] ?? status}
            </Badge>
            {(status === "pending" || status === "under_review") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={checkStatus}
                disabled={checkingStatus}
              >
                {checkingStatus && <Spinner />}
                Refresh status
              </Button>
            )}
          </div>
        )}

        <FieldSet>
          <FieldLegend>Business &amp; contact</FieldLegend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Address</FieldLegend>
          <Field>
            <FieldLabel htmlFor="address-street1">Address</FieldLabel>
            <Input
              id="address-street1"
              value={addressStreet1}
              onChange={(event) => setAddressStreet1(event.target.value)}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Bank details</FieldLegend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </FieldSet>
      </FieldGroup>

      <div className="mt-6 flex justify-end border-t pt-6">
        <Button type="submit" disabled={loading}>
          {loading && <Spinner />}
          Save payout account
        </Button>
      </div>
    </form>
  );
}
