const ADMIN_EMAILS = ['your-admin@email.com'];

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
