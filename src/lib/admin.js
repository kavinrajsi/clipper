// Super admin is an env-var email compare, not a database flag, and it hands
// out a service-role client — so the email has to be one Supabase actually
// verified. Without the email_confirmed_at check, anyone who can reach
// /auth/v1/signup (the publishable key ships in the client bundle) could
// register SUPER_ADMIN_EMAIL themselves and, with email confirmations off,
// hold a usable session immediately.
//
// An unset or empty SUPER_ADMIN_EMAIL fails closed: the Boolean(user?.email)
// short-circuit means the undefined === undefined case is never reached.
export function isSuperAdmin(user) {
  if (!user?.email || !user.email_confirmed_at) return false;
  const configured = process.env.SUPER_ADMIN_EMAIL;
  if (!configured) return false;
  return user.email === configured;
}
