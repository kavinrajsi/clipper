"use client"

import { RouteError } from "@/components/route-error"

export default function LegalError({ error, reset }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="This document didn't load"
      description="Try again. If you need these terms urgently, email support and we'll send them over."
    />
  )
}
