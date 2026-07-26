"use client"

import { RouteError } from "@/components/route-error"

export default function PublicError({ error, reset }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="We couldn't load this profile"
      description="The creator directory didn't respond. Try again, or browse from the directory."
      homeHref="/discover"
    />
  )
}
