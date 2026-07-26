import Link from "next/link";
import { UserRoundSearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// An unpublished profile and a nonexistent handle both land here. The copy
// deliberately does not distinguish them — confirming that a handle exists but
// is private leaks something the owner chose not to share.
export default function CreatorNotFound() {
  return (
    <div className="flex flex-1 flex-col justify-center p-6">
      <Empty className="mx-auto w-full max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserRoundSearchIcon />
          </EmptyMedia>
          <EmptyTitle>Profile not available</EmptyTitle>
          <EmptyDescription>
            This creator profile doesn&apos;t exist, or its owner hasn&apos;t published it.
          </EmptyDescription>
        </EmptyHeader>
        <Button nativeButton={false} render={<Link href="/" />}>
          Go home
        </Button>
      </Empty>
    </div>
  );
}
