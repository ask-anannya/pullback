"use client";

import { useState } from "react";
import { useCart } from "./cart";

export function AddToCart({ sku, disabled = false, compact = false }: { sku: string; disabled?: boolean; compact?: boolean }) {
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  function onAdd() {
    add(sku, compact ? 1 : qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  }

  if (compact) {
    return (
      <button
        className="flex h-10 min-w-10 items-center justify-center rounded-full bg-cocoa px-3 text-sm font-bold text-cream transition hover:bg-tomato disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onAdd}
        disabled={disabled}
        aria-label="Add to cart"
      >
        {added ? "Added" : "+ Add"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center rounded-full border-2 border-cocoa/20 bg-white">
        <button className="h-11 w-11 text-lg font-bold disabled:opacity-30" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={disabled || qty <= 1} aria-label="Fewer">
          −
        </button>
        <span className="w-8 text-center font-bold tabular-nums" aria-live="polite">
          {qty}
        </span>
        <button className="h-11 w-11 text-lg font-bold disabled:opacity-30" onClick={() => setQty((q) => Math.min(20, q + 1))} disabled={disabled} aria-label="More">
          +
        </button>
      </div>
      <button className="shop-btn" onClick={onAdd} disabled={disabled}>
        {disabled ? "Unavailable" : added ? "Added to cart" : "Add to cart"}
      </button>
    </div>
  );
}
