"use client"

import { useEffect } from "react"
import Link from "next/link"
import { TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

// The body of every route-group error.js. Those files have to be client
// components themselves, so they stay thin wrappers around this and only supply
// copy that says what part of the product failed.
//
// Deliberately never renders error.message: in production Next.js replaces it
// with a generic string anyway, and in development it is a stack-adjacent
// detail that tells a user nothing they can act on. The digest is shown
// because it is the one thing worth quoting to support.
export function RouteError({
  error,
  reset,
  title = "This page didn't load",
  description = "Something on our side failed while putting this page together. Trying again usually works.",
  homeHref = "/",
}) {
  useEffect(() => {
    // The server-side cause is already in the server logs; this is what makes
    // the client half visible too.
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col justify-center p-6">
      <Empty className="mx-auto w-full max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" nativeButton={false} render={<Link href={homeHref} />}>
              Go back
            </Button>
          </div>
          {error?.digest && (
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              Reference {error.digest}
            </p>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}
