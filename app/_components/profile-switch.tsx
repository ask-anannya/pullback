"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Demo profile switch: the same site seen as the shopper or as the store owner (no login). */
export function ProfileSwitch({ tone = "shop" }: { tone?: "shop" | "seller" }) {
  const path = usePathname() ?? "/";
  const seller = path.startsWith("/seller");
  const base =
    tone === "shop" ? "border-cocoa/15 bg-white text-cocoa" : "border-line bg-paper text-ink";
  const on = tone === "shop" ? "bg-cocoa text-cream" : "bg-accent text-white";
  return (
    <div className={`inline-flex items-center rounded-full border p-1 text-xs font-semibold ${base}`} role="group" aria-label="Switch profile">
      <span className="hidden px-2 font-medium opacity-60 sm:inline">View as</span>
      <Link href="/" className={`rounded-full px-3 py-1.5 transition ${!seller ? on : "opacity-70 hover:opacity-100"}`} aria-current={!seller ? "page" : undefined}>
        Shopper
      </Link>
      <Link href="/seller" className={`rounded-full px-3 py-1.5 transition ${seller ? on : "opacity-70 hover:opacity-100"}`} aria-current={seller ? "page" : undefined}>
        Store owner
      </Link>
    </div>
  );
}
