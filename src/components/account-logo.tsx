"use client";

import { useEffect, useRef, useState } from "react";

/** The account's logo, or its initials when there is none or it fails to load. */
export function AccountLogo({ name, url, className }: { name: string; url?: string | null; className: string }) {
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // A load error before the page is interactive never reaches onError: check once mounted.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  }, [url]);
  const initials = name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className={`${className} has-logo`} aria-hidden><img ref={img} src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /></span>;
  }
  return <span className={className} aria-hidden>{initials}</span>;
}
