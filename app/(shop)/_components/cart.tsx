"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartLine = { sku: string; qty: number };

type Cart = {
  lines: CartLine[];
  count: number;
  ready: boolean;
  add: (sku: string, qty?: number) => void;
  setQty: (sku: string, qty: number) => void;
  remove: (sku: string) => void;
  clear: () => void;
};

const KEY = "trailhead-cart";
const CartContext = createContext<Cart | null>(null);

function load(): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => typeof l?.sku === "string" && Number.isInteger(l?.qty) && l.qty > 0) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(load());
    setReady(true);
  }, []);

  const save = useCallback((next: CartLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: the cart still works for this page view */
    }
  }, []);

  const value = useMemo<Cart>(
    () => ({
      lines,
      ready,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (sku, qty = 1) => {
        const cur = lines.find((l) => l.sku === sku);
        save(cur ? lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(20, l.qty + qty) } : l)) : [...lines, { sku, qty }]);
      },
      setQty: (sku, qty) => save(qty <= 0 ? lines.filter((l) => l.sku !== sku) : lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(20, qty) } : l))),
      remove: (sku) => save(lines.filter((l) => l.sku !== sku)),
      clear: () => save([]),
    }),
    [lines, ready, save],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): Cart {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}

export function CartCount() {
  const { count, ready } = useCart();
  if (!ready || count === 0) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-tomato px-1 text-[11px] font-bold text-white">
      {count}
    </span>
  );
}
