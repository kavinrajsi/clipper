"use client"

import { RouteError } from "@/components/route-error"

export default function AppError({ error, reset }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="This page didn't load"
      description="Something failed while building the page. Trying again usually works — the campaigns themselves are unaffected."
    />
  )
}
