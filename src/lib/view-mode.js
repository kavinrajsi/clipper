// Card grid or table, for the campaign and creator list pages.
//
// One cookie across all of them: the preference people have is "I like
// tables", not "I like tables on this one route".
//
// URL wins so a link is shareable and the back button works; the cookie is
// only the fallback, so the choice also survives arriving at the page fresh
// with no query string. Reading it server-side means the right view renders
// first time — no flash of the wrong one, and the pages stay Server
// Components.

export const VIEW_COOKIE = "list_view";
export const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const VIEWS = ["card", "table"];
export const DEFAULT_VIEW = "card";

// `value` comes straight off the query string and goes straight into a branch,
// so it is validated rather than trusted. searchParams gives back
// `string | string[] | undefined`; an array means ?view=a&view=b.
export function resolveView(value, cookieStore) {
  const fromUrl = Array.isArray(value) ? value[0] : value;
  if (VIEWS.includes(fromUrl)) return fromUrl;

  const fromCookie = cookieStore?.get(VIEW_COOKIE)?.value;
  if (VIEWS.includes(fromCookie)) return fromCookie;

  return DEFAULT_VIEW;
}
