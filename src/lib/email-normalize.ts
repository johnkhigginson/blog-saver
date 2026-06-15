/**
 * Canonicalizes an email so address aliases collapse to one identity.
 * Gmail ignores dots in the local part, and most providers treat a "+tag"
 * suffix as an alias, so both are stripped before uniqueness checks. This is
 * what stops the gmail dot-trick mass-signup abuse.
 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at === -1) return email;

  let local = email.slice(0, at);
  const domain = email.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}
