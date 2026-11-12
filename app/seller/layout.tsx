import Link from "next/link";
import { ProfileSwitch } from "../_components/profile-switch";

const NAV = [
  { href: "/seller", label: "Overview" },
  { href: "/seller/review", label: "Needs review" },
  { href: "/seller/activity", label: "Activity" },
  { href: "/seller/outbox", label: "Outbox" },
  { href: "/seller/replay", label: "Replay" },
];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/seller" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="inline-block h-3 w-3 rounded-full bg-accent" aria-hidden />
            Pullback
            <span className="hidden text-xs font-normal text-muted sm:inline">for Trailhead Pantry</span>
          </Link>
          <ProfileSwitch tone="seller" />
          <nav className="-mx-1 flex w-full gap-1 overflow-x-auto text-sm md:w-auto">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="shrink-0 rounded-md px-3 py-1.5 text-muted hover:bg-paper hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
