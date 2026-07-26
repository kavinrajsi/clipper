import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatClipperRate } from "@/lib/format"

function getInitials(name) {
  if (!name) return "?"
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}


export function ClipperDirectoryCard({ clipperProfile, profile }) {
  const rate = formatClipperRate(clipperProfile)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={profile?.avatar_url} alt={profile?.full_name} />
            <AvatarFallback>{getInitials(profile?.full_name)}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle>{profile?.full_name ?? "Unnamed clipper"}</CardTitle>
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
