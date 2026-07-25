export function isSuperAdmin(user) {
  return Boolean(user?.email) && user.email === process.env.SUPER_ADMIN_EMAIL;
}
