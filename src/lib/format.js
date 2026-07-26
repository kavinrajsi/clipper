import { formatDistanceToNow } from "date-fns";

// Locale split is deliberate:
//   - Money and dates use en-IN, matching the rest of the product (day-first
//     dates, INR, lakh grouping on currency).
//   - Raw view/engagement counts use en-US grouping, because that is how
//     YouTube itself renders them. en-IN would show 4,20,000 where every other
//     analytics surface the user sees shows 420,000.
const MONEY_LOCALE = "en-IN";
const DATE_LOCALE = "en-IN";
const COUNT_LOCALE = "en-US";

const DATE_STYLES = {
  // 05/01/2026 — used by the admin tables
  numeric: { day: "2-digit", month: "2-digit", year: "numeric" },
  // 5 Jan 2026 — used by the activity feed
  medium: { month: "short", day: "numeric", year: "numeric" },
  // 5 Jan — chart axes and tooltips, where the year is redundant
  short: { month: "short", day: "numeric" },
};

export function formatCurrency(amount, { fallback = "—" } = {}) {
  if (amount == null) return fallback;
  return new Intl.NumberFormat(MONEY_LOCALE, {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

export function formatNumber(value) {
  return new Intl.NumberFormat(COUNT_LOCALE).format(value ?? 0);
}

// 4.2K / 1.3M — for follower counts and anywhere an exact number is noise.
export function formatCompactNumber(value) {
  return new Intl.NumberFormat(COUNT_LOCALE, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export function formatDate(value, { fallback = "—", style = "numeric" } = {}) {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString(DATE_LOCALE, DATE_STYLES[style] ?? DATE_STYLES.numeric);
}

export function formatDateTime(value, { fallback = "—" } = {}) {
  if (!value) return fallback;
  return new Date(value).toLocaleString(DATE_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRelativeTime(value, { fallback = "—" } = {}) {
  if (!value) return fallback;
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

// Campaigns pay a flat fee or a rate per 1,000 views.
export function formatCampaignRate(campaign) {
  const amount = formatCurrency(campaign?.payout_rate ?? 0);
  return campaign?.payout_structure === "flat_fee" ? `${amount} flat` : `${amount} / 1,000 views`;
}

// Clippers price per campaign, per 1,000 views (CPM), or per clip. Returns null
// when the profile hasn't set a rate, so callers can omit the line entirely.
export function formatClipperRate(clipperProfile) {
  if (!clipperProfile?.pricing_model || clipperProfile.rate_amount == null) return null;
  const amount = formatCurrency(clipperProfile.rate_amount);
  if (clipperProfile.pricing_model === "flat_campaign") return `${amount} flat`;
  if (clipperProfile.pricing_model === "cpm") return `${amount} CPM`;
  return `${amount} / clip`;
}
