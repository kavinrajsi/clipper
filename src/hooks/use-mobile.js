import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// useSyncExternalStore rather than useState + useEffect: the viewport is an
// external store, and seeding state from an effect meant a synchronous setState
// on mount (react-hooks/set-state-in-effect) plus one extra render every time.
// The third argument is the server snapshot — false, matching the old hook,
// which started at `undefined` and returned `!!isMobile`.
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
