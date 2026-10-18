"use client";
import { useState } from "react";
import { BASE } from "@/lib/api";

/* An AI provider's logo for the onboarding cards. It shows the provider's own icon: a file the team placed in
   public/providers/<id>.svg (from the vendor's brand kit) when there is one, else the icon the vendor's website serves.
   Offline, it falls back to the first letter on a soft tile. */
export default function ProviderLogo({ id, domain, label, size = 36 }: { id: string; domain: string; label: string; size?: number }) {
  const sources = [`${BASE}/providers/${id}.svg`, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`];
  const [i, setI] = useState(0);
  if (i >= sources.length) {
    return <span className="plogo letter" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>{label.slice(0, 1)}</span>;
  }
  return (
    <span className="plogo" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sources[i]} alt="" width={size * 0.66} height={size * 0.66} onError={() => setI(i + 1)} />
    </span>
  );
}
