import { normalizeEmail } from "./email-normalize";

/**
 * Which addresses may hold the ADMIN system role. ADMIN is an elevation: it
 * grants access across every blog, not just the ones a user owns. Registration
 * therefore never infers it, it is only granted to an address the operator has
 * named in ADMIN_EMAILS.
 *
 * Unset (the default) means no account is ever auto-promoted. That is the safe
 * posture for a public deployment: without it, whoever registers first on a
 * fresh database would silently gain access to everyone else's blogs. A
 * deployment with no admin is fully functional, since users own and manage
 * their own blogs; promote an account by hand in the database if you need one.
 *
 * Entries are comma-separated and normalized the same way stored addresses
 * are, so allowlisting "Me+tag@Gmail.com" matches the account it creates.
 */
export function adminAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map(normalizeEmail);
}

export function isAllowlistedAdmin(email: string): boolean {
  return adminAllowlist().includes(normalizeEmail(email));
}
