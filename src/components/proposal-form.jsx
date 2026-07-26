"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatCampaignRate, formatCurrency, formatNumber } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const MAX_ATTACHMENTS = 5;

export function ProposalForm({ campaign, portfolioItems = [] }) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  // Bid defaults to the posted rate. It is optional by design — mandatory
  // bidding turns every campaign into a price race and erodes creator margin.
  const [bid, setBid] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [selected, setSelected] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function toggleItem(id) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((i) => i !== id)
        : current.length >= MAX_ATTACHMENTS
          ? current
          : [...current, id]
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      setError("Sign in again to apply.");
      return;
    }

    const { data: application, error: insertError } = await supabase
      .from("campaign_applications")
      .insert({
        campaign_id: campaign.id,
        clipper_id: user.id,
        message: message || null,
        bid_amount: bid === "" ? null : Number(bid),
        estimated_delivery_days: deliveryDays === "" ? null : Number(deliveryDays),
      })
      .select()
      .single();

    if (insertError) {
      setSubmitting(false);
      if (insertError.code === "23505") {
        setError("You've already applied to this campaign.");
      } else if (insertError.code === "42501") {
        setError("This campaign isn't open for applications.");
      } else {
        setError(insertError.message);
      }
      return;
    }

    // Attachments are secondary — a failure here shouldn't lose the
    // application the creator just wrote.
    if (selected.length > 0) {
      const { error: attachError } = await supabase.from("proposal_attachments").insert(
        selected.map((portfolioItemId) => ({
          application_id: application.id,
          portfolio_item_id: portfolioItemId,
        }))
      );
      if (attachError) {
        setSubmitting(false);
        setOpen(false);
        toast.warning("Applied, but your clips couldn't be attached.");
        router.refresh();
        return;
      }
    }

    setSubmitting(false);
    setOpen(false);
    toast.success("Application sent.");
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" />}>Apply</SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Apply to {campaign.title}</SheetTitle>
          <SheetDescription>
            Posted rate: {formatCampaignRate(campaign)}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="px-4 pb-4">
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="cover-letter">Why you&apos;re a good fit</FieldLabel>
              <Textarea
                id="cover-letter"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                placeholder="What you'd do with this brief, and why you're the right person for it."
              />
            </Field>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Terms</FieldLegend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="bid">Your rate (INR)</FieldLabel>
                  <Input
                    id="bid"
                    type="number"
                    min="1"
                    step="0.01"
                    value={bid}
                    onChange={(event) => setBid(event.target.value)}
                    placeholder={campaign.payout_rate ?? ""}
                  />
                  <FieldDescription>
                    Leave blank to accept the posted rate of{" "}
                    {formatCurrency(campaign.payout_rate)}.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="delivery">Delivery (days)</FieldLabel>
                  <Input
                    id="delivery"
                    type="number"
                    min="1"
                    max="365"
                    value={deliveryDays}
                    onChange={(event) => setDeliveryDays(event.target.value)}
                    placeholder="7"
                  />
                  <FieldDescription>Optional, but brands sort on it.</FieldDescription>
                </Field>
              </div>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Relevant work</FieldLegend>
              {portfolioItems.length === 0 ? (
                <FieldDescription>
                  You have no clips in your portfolio yet.{" "}
                  <Link href="/clipper-profile" className="underline underline-offset-4">
                    Add some
                  </Link>{" "}
                  — applications with work attached get taken more seriously.
                </FieldDescription>
              ) : (
                <>
                  <FieldDescription>
                    Pick up to {MAX_ATTACHMENTS} clips that fit this brief. {selected.length}{" "}
                    selected.
                  </FieldDescription>
                  <div className="flex flex-col gap-1">
                    {portfolioItems.map((item) => {
                      const isSelected = selected.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleItem(item.id)}
                          aria-pressed={isSelected}
                          className={`flex items-center gap-3 rounded-md border p-2 text-left ${
                            isSelected ? "border-primary bg-muted" : "border-transparent hover:bg-muted"
                          }`}
                        >
                          {item.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.thumbnail_url}
                              alt=""
                              className="aspect-video w-20 shrink-0 rounded object-cover"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-1 block text-sm font-medium">
                              {item.title ?? "Untitled clip"}
                            </span>
                            {item.view_count != null && (
                              <span className="block text-xs text-muted-foreground tabular-nums">
                                {formatNumber(item.view_count)} views
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </FieldSet>
          </FieldGroup>

          <div className="mt-6 flex justify-end border-t pt-6">
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner />}
              Send application
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
