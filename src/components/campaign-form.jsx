"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { openCampaignCheckout } from "@/lib/razorpay-checkout"
import { PencilIcon, PlusIcon } from "lucide-react"

const PAYOUT_STRUCTURES = [
  { label: "Per 1,000 views", value: "per_view" },
  { label: "Flat campaign fee", value: "flat_fee" },
]

const VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Anyone",
    description: "Listed for every clipper once the campaign is funded and active.",
  },
  {
    value: "invite_only",
    label: "Invite only",
    description: "Unlisted. Only clippers you invite can see it or apply.",
  },
  {
    value: "private",
    label: "Private",
    description: "Unlisted, and not accepting new applicants.",
  },
]

export function CampaignForm({ brandId, campaign, workspaceId, templates = [] }) {
  const isEditing = Boolean(campaign)
  const financialFieldsLocked = isEditing && campaign.funding_status !== "unfunded"

  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(campaign?.title ?? "")
  const [description, setDescription] = useState(campaign?.description ?? "")
  const [requirements, setRequirements] = useState(campaign?.requirements ?? "")
  const [payoutStructure, setPayoutStructure] = useState(campaign?.payout_structure ?? "per_view")
  const [payoutRate, setPayoutRate] = useState(campaign?.payout_rate ?? "")
  const [budget, setBudget] = useState(campaign?.budget ?? "")
  const [deadline, setDeadline] = useState(campaign?.deadline ?? "")
  const [visibility, setVisibility] = useState(campaign?.visibility ?? "public")
  const [templateId, setTemplateId] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  function applyTemplate(id) {
    const template = templates.find((t) => t.id === id)
    if (!template) return
    setTemplateId(id)

    // Creative fields only. A template never carries budget or funding state —
    // pre-filling money is a mis-click waiting to happen.
    const payload = template.payload ?? {}
    if (payload.requirements) setRequirements(payload.requirements)
    if (payload.description) setDescription(payload.description)
    if (payload.payout_structure && !financialFieldsLocked) {
      setPayoutStructure(payload.payout_structure)
    }
  }

  function resetForm() {
    setTitle(campaign?.title ?? "")
    setDescription(campaign?.description ?? "")
    setRequirements(campaign?.requirements ?? "")
    setPayoutStructure(campaign?.payout_structure ?? "per_view")
    setPayoutRate(campaign?.payout_rate ?? "")
    setBudget(campaign?.budget ?? "")
    setDeadline(campaign?.deadline ?? "")
    setVisibility(campaign?.visibility ?? "public")
    setTemplateId(null)
    setError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const fields = {
      title,
      description: description || null,
      requirements: requirements || null,
      deadline: deadline || null,
      visibility,
      // Create only. On edit templateId is null, so including it here would
      // wipe the attribution of a campaign that was created from a template.
      ...(isEditing ? {} : { template_id: templateId }),
      ...(financialFieldsLocked
        ? {}
        : {
            payout_structure: payoutStructure,
            payout_rate: payoutRate === "" ? null : Number(payoutRate),
            budget: Number(budget),
          }),
    }

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("campaigns")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", campaign.id)

      setLoading(false)

      if (updateError) {
        setError(updateError.message)
        return
      }

      setOpen(false)
      router.refresh()
      return
    }

    const { data: newCampaign, error: insertError } = await supabase
      .from("campaigns")
      .insert({ brand_id: brandId, workspace_id: workspaceId ?? campaign?.workspace_id, ...fields })
      .select()
      .single()

    setLoading(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    resetForm()
    setOpen(false)
    router.refresh()

    openCampaignCheckout(newCampaign.id, {
      onSuccess: () => router.refresh(),
      onError: () => router.refresh(),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger
        render={
          isEditing ? <Button variant="outline" size="sm" /> : <Button />
        }
      >
        {isEditing ? (
          <>
            <PencilIcon />
            Edit
          </>
        ) : (
          <>
            <PlusIcon />
            Create Campaign
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit campaign" : "Create a campaign"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? financialFieldsLocked
                ? "Payout and budget are locked — this campaign has already been funded."
                : "Payout and budget can still be changed since this campaign isn't funded yet."
              : "You'll be asked to fund the budget via Razorpay next — the campaign goes live once payment is confirmed."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!isEditing && templates.length > 0 && (
              <Field>
                <FieldLabel htmlFor="template">Start from a template</FieldLabel>
                <Select value={templateId ?? ""} onValueChange={applyTemplate}>
                  <SelectTrigger id="template">
                    <SelectValue placeholder="Blank campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Fills the brief and payout structure. Budget and deadline are always yours to
                  set.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="title">Title</FieldLabel>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="requirements">Content requirements</FieldLabel>
              <Textarea
                id="requirements"
                placeholder="Guidelines for the clips you want"
                value={requirements}
                onChange={(event) => setRequirements(event.target.value)}
                rows={3}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="payout-structure">Payout structure</FieldLabel>
                <Select
                  value={payoutStructure}
                  onValueChange={setPayoutStructure}
                  items={PAYOUT_STRUCTURES}
                  disabled={financialFieldsLocked}
                >
                  <SelectTrigger id="payout-structure" className="w-full">
                    <SelectValue placeholder="Select a structure" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {PAYOUT_STRUCTURES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="payout-rate">
                  {payoutStructure === "flat_fee" ? "Flat fee (INR)" : "Rate per 1,000 views (INR)"}
                </FieldLabel>
                <Input
                  id="payout-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={payoutRate}
                  onChange={(event) => setPayoutRate(event.target.value)}
                  disabled={financialFieldsLocked}
                  required
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="budget">Budget (INR)</FieldLabel>
                <Input
                  id="budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  disabled={financialFieldsLocked}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="deadline">Deadline</FieldLabel>
                <Input
                  id="deadline"
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="visibility">Who can see this</FieldLabel>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger id="visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {VISIBILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.description}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner />}
              {isEditing ? "Save changes" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
