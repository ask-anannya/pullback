import Link from "next/link";
import { CartCount, CartProvider } from "./_components/cart";
import { ProfileSwitch } from "../_components/profile-switch";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="shop-root min-h-screen">
        <header className="sticky top-0 z-30 border-b-2 border-cream-deep bg-cream/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden>
                <circle cx="20" cy="20" r="19" fill="var(--color-tomato)" />
                <path d="M7 29 L16 15 L21 22 L25 17 L33 29 Z" fill="var(--color-cream)" />
                <circle cx="28" cy="12" r="3" fill="var(--color-mustard)" />
              </svg>
              <span className="font-display text-xl leading-none font-extrabold tracking-tight">
                Trailhead
                <span className="block text-[11px] font-bold tracking-[0.2em] text-tomato uppercase">Pantry</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-semibold md:flex">
              <Link href="/shop" className="hover:text-tomato">
                Shop all
              </Link>
              <Link href="/shop?c=trail-mix" className="hover:text-tomato">
                Trail mix
              </Link>
              <Link href="/#promise" className="hover:text-tomato">
                Our promise
              </Link>
              <Link href="/orders" className="hover:text-tomato">
                My orders
              </Link>
            </nav>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:block">
                <ProfileSwitch />
              </div>
              <Link href="/orders" className="rounded-full p-2 hover:bg-cream-deep md:hidden" aria-label="My orders">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                </svg>
              </Link>
              <Link href="/cart" className="relative rounded-full bg-cocoa p-2.5 text-cream hover:bg-tomato" aria-label="Cart">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 7h14l-1.5 12h-11z" />
                  <path d="M9 7a3 3 0 0 1 6 0" />
                </svg>
                <CartCount />
              </Link>
            </div>
          </div>
          <div className="flex justify-center border-t border-cream-deep py-2 sm:hidden">
            <ProfileSwitch />
          </div>
        </header>
        <main>{children}</main>
        <footer className="mt-20 bg-cocoa text-cream">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
            <div>
              <div className="font-display text-2xl font-extrabold">Trailhead Pantry</div>
              <p className="mt-2 max-w-xs text-sm text-cream/70">Small-batch trail mix, nuts and snacks for the long way round. A fictional store for the Pullback demo.</p>
            </div>
            <div className="text-sm">
              <div className="font-bold">Shop</div>
              <ul className="mt-2 space-y-1 text-cream/70">
                <li>
                  <Link href="/shop" className="hover:text-mustard">
                    All snacks
                  </Link>
                </li>
                <li>
                  <Link href="/orders" className="hover:text-mustard">
                    My orders
                  </Link>
                </li>
              </ul>
            </div>
            <div className="text-sm text-cream/70">
              <div className="font-bold text-cream">Recall promise</div>
              <p className="mt-2">Every jar is tracked to its batch. If a product we sold you is ever recalled, we refund it through PayPal and tell you right away.</p>
            </div>
          </div>
          <div className="border-t border-cream/10 py-4 text-center text-xs text-cream/50">Payments run in the PayPal sandbox. No real money moves.</div>
        </footer>
      </div>
    </CartProvider>
  );
}
