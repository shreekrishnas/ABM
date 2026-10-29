// Account logos: a Super Admin pastes either the logo image's address or the account's website.
// An image address is kept as is; a website becomes that site's icon.

const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|avif)(\?.*)?$/i;

/** The logo URL to store, null to clear, or an error message. */
export function logoFromInput(raw: string): { url: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { url: null };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return { error: "Enter a logo image link or the website address" };
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return { error: "Enter a logo image link or the website address" };
  u.protocol = "https:";
  if (IMAGE.test(u.pathname) || u.pathname.startsWith("/s2/favicons")) return { url: u.toString() };
  return { url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname.replace(/^www\./, ""))}&sz=128` };
}
