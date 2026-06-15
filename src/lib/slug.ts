// URL-friendly slug helpers. Uniqueness is enforced in application code because
// SQL Server unique indexes only permit a single NULL row, which makes a
// nullable `@unique` column impractical for drafts that haven't been slugged yet.

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/**
 * Returns a slug derived from `base` that is not present in `taken`. Appends a
 * numeric suffix (-2, -3, …) on collision. Falls back to `fallback` when the
 * base slugifies to an empty string (e.g. titles with no latin characters).
 */
export function uniqueSlug(
  base: string,
  taken: Set<string>,
  fallback = "item"
): string {
  const root = slugify(base) || fallback;
  if (!taken.has(root)) {
    taken.add(root);
    return root;
  }
  let n = 2;
  while (taken.has(`${root}-${n}`)) n++;
  const result = `${root}-${n}`;
  taken.add(result);
  return result;
}
