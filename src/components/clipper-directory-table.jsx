import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SaveButton } from "@/components/save-button";
import { VerifiedBadge } from "@/components/verified-badge";
import { formatClipperRate, formatNumber } from "@/lib/format";

// The table counterpart to ClipperDirectoryCard, and a Server Component for the
// same reason that one is — SaveButton brings its own client boundary.
//
// Takes the same shape of row both its callers already build: /clippers passes
// { clipperProfile, profile } and /saved adds verification, stats and the save
// props.

function getInitials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function ClipperDirectoryTable({ creators = [], showSave = false, isAuthenticated }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Creator</TableHead>
            <TableHead>Availability</TableHead>
            <TableHead>Verified views</TableHead>
            <TableHead>Rate</TableHead>
            {showSave && <TableHead className="text-right">Saved</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {creators.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={showSave ? 5 : 4}
                className="h-24 text-center text-muted-foreground"
              >
                No creators to show.
              </TableCell>
            </TableRow>
          ) : (
            creators.map(({ clipperProfile, profile, verification, stats, saved }) => {
              const name = profile?.full_name ?? "Unnamed clipper";
              const href =
                clipperProfile.is_public && clipperProfile.handle
                  ? `/c/${clipperProfile.handle}`
                  : null;

              return (
                <TableRow key={clipperProfile.user_id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarImage src={profile?.avatar_url} alt={name} />
                        <AvatarFallback className="text-xs">
                          {getInitials(profile?.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      {href ? (
                        <Link href={href} className="underline-offset-4 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                      <VerifiedBadge verification={verification} />
                    </span>
                  </TableCell>

                  <TableCell>
                    {clipperProfile.availability_status ? (
                      <Badge
                        variant={
                          clipperProfile.availability_status === "available"
                            ? "default"
                            : "outline"
                        }
                      >
                        {clipperProfile.availability_status}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Same rule the card uses: nothing synced means no number,
                      rather than a row of confident-looking zeroes. */}
                  <TableCell className="tabular-nums">
                    {stats?.videos_synced > 0 ? (
                      formatNumber(stats.verified_views)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {formatClipperRate(clipperProfile) || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {showSave && (
                    <TableCell>
                      <div className="flex justify-end">
                        <SaveButton
                          type="creator"
                          targetId={clipperProfile.user_id}
                          initialSaved={saved}
                          isAuthenticated={isAuthenticated}
                          signInHref={`/login?next=${encodeURIComponent(href ?? "/discover")}`}
                        />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
