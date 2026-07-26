"use client"

import { RouteError } from "@/components/route-error"

export default function ProtectedError({ error, reset }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="We couldn't load this page"
      description="Your data is fine — this is a problem fetching it. Try again, or head to your dashboard."
      homeHref="/dashboard"
    />
  )
}
