import { BadgeCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Surfaces youtube_connections.verification_method, which the platform already
// records but has never shown to the brands it exists to reassure.
//
// There is deliberately no "unverified" state — a negative badge creates a
// caste system and depresses supply. Unverified creators simply show nothing.
const TIERS = {
  linked: {
    label: "Verified",
    variant: "default",
    tooltip: "Channel ownership verified through Google",
  },
  bio_code: {
    label: "Verified",
    variant: "outline",
    tooltip: "Verified with a bio code",
  },
};

export function VerifiedBadge({ verification, className }) {
  const method = verification?.verification_method;
  const tier = TIERS[method];
  if (!tier) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={tier.variant} className={className}>
            <BadgeCheckIcon />
            {tier.label}
          </Badge>
        }
      />
      <TooltipContent>{tier.tooltip}</TooltipContent>
    </Tooltip>
  );
}
