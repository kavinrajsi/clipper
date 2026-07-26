import Link from "next/link"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { VerifiedBadge } from "@/components/verified-badge"
import { formatClipperRate, formatNumber } from "@/lib/format"

function getInitials(name) {
  if (!name) return "?"
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

// Used by both /clippers (brand-only, shows every profile) and /discover
// (public, published profiles only). `verification` and `stats` are optional —
// /clippers doesn't fetch them.
export function ClipperDirectoryCard({ clipperProfile, profile, verification, stats }) {
  const rate = formatClipperRate(clipperProfile)
  const name = profile?.full_name ?? "Unnamed clipper"
  const href = clipperProfile.is_public && clipperProfile.handle
    ? `/c/${clipperProfile.handle}`
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={profile?.avatar_url} alt={name} />
            <AvatarFallback>{getInitials(profile?.full_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {href ? (
                <Link href={href} className="hover:underline underline-offset-4">
                  {name}
                </Link>
              ) : (
                name
              )}
              <VerifiedBadge verification={verification} />
            </CardTitle>
            {clipperProfile.availability_status && (
              <Badge
                variant={clipperProfile.availability_status === "available" ? "default" : "outline"}
                className="mt-1"
              >
                {clipperProfile.availability_status}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {clipperProfile.headline && (
          <p className="text-sm font-medium">{clipperProfile.headline}</p>
        )}
        {/* Verified delivered performance — omitted entirely rather than shown
            as zeroes when the creator hasn't synced a channel. */}
        {stats?.videos_synced > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatNumber(stats.verified_views)} verified views · {formatNumber(stats.videos_synced)} clips
          </p>
        )}
        {clipperProfile.bio && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{clipperProfile.bio}</p>
        )}
        {clipperProfile.categories?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clipperProfile.categories.map((category) => (
              <Badge key={category} variant="secondary">
                {category}
              </Badge>
            ))}
          </div>
        )}
        {clipperProfile.style_tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clipperProfile.style_tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {rate && <p className="text-sm font-medium">{rate}</p>}
      </CardContent>
    </Card>
  );
}
