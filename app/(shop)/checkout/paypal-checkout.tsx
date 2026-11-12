"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { shortName } from "@/shop/display";
import { useCart, type CartLine } from "../_components/cart";
import type { CatalogItem } from "../_components/catalog";

type PayPalNamespace = {
  Buttons(opts: {
    style?: Record<string, string | number>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError: (err: unknown) => void;
  }): { render(el: HTMLElement): Promise<void>; close?: () => Promise<void> };
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

function usePayPalSdk(clientId: string) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (window.paypal) return setReady(true);
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    s.onload = () => setReady(true);
    s.onerror = () => setFailed(true);
    document.body.appendChild(s);
  }, [clientId]);
  return { ready, failed };
}

export function PayPalCheckout({ catalog, clientId }: { catalog: Record<string, CatalogItem>; clientId: string }) {
  const router = useRouter();
  const { lines, ready: cartReady, clear } = useCart();
  const { ready, failed } = usePayPalSdk(clientId);
  const [status, setStatus] = useState<{ kind: "idle" | "working" | "error"; msg?: string }>({ kind: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const linesRef = useRef<CartLine[]>(lines);
  linesRef.current = lines;

  const known = lines.filter((l) => catalog[l.sku]);
  const total = known.reduce((s, l) => s + l.qty * catalog[l.sku].priceCents, 0);

  useEffect(() => {
    if (!ready || !window.paypal || !box.current || rendered.current || !known.length) return;
    rendered.current = true;
    window.paypal
      .Buttons({
        style: { shape: "pill", color: "gold", label: "pay", height: 48 },
        createOrder: async () => {
          setStatus({ kind: "idle" });
          const r = await fetch("/api/shop/checkout/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: linesRef.current.map((l) => ({ sku: l.sku, qty: l.qty })) }),
          });
          const j = await r.json();
          if (!r.ok) {
            setStatus({ kind: "error", msg: j.error ?? "Could not start checkout." });
            throw new Error(j.error);
          }
          return j.id;
        },
        onApprove: async (data) => {
          setStatus({ kind: "working", msg: "Confirming your payment" });
          const r = await fetch("/api/shop/checkout/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paypalOrderId: data.orderID }),
          });
          const j = await r.json();
          if (!r.ok) return setStatus({ kind: "error", msg: j.error ?? "Payment could not be completed." });
          clear();
          router.push(`/orders?placed=${j.orderId}`);
        },
        onCancel: () => setStatus({ kind: "idle" }),
        onError: (err) => setStatus((s) => (s.kind === "error" ? s : { kind: "error", msg: `PayPal error: ${String((err as Error)?.message ?? err)}` })),
      })
      .render(box.current);
  });

  if (!cartReady) return <div className="mt-8 h-40 animate-pulse rounded-3xl bg-cream-deep" />;
  if (!known.length && status.kind !== "working") {
    return (
      <div className="shop-card mt-8 p-10 text-center">
        <p className="text-lg font-semibold">Nothing to check out yet.</p>
        <Link href="/shop" className="shop-btn mt-5">
          Find a snack
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-6 md:grid-cols-5">
      <section className="shop-card p-5 md:col-span-3">
        <h2 className="font-display text-xl font-bold">Order summary</h2>
        <ul className="mt-3 divide-y-2 divide-cream-deep">
          {known.map((l) => {
            const p = catalog[l.sku];
            return (
              <li key={l.sku} className="flex justify-between gap-3 py-2 text-sm">
                <span>
                  {l.qty} × {shortName(p.name, p.brand, p.sizeText)} <span className="text-cocoa-soft">({p.brand}, {p.sizeText})</span>
                </span>
                <span className="font-semibold tabular-nums">{formatUsd(l.qty * p.priceCents)}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex justify-between border-t-2 border-cream-deep pt-3 font-display text-xl font-extrabold">
          <span>Total</span>
          <span className="tabular-nums">{formatUsd(total)}</span>
        </div>
      </section>
      <section className="shop-card p-5 md:col-span-2">
        <h2 className="font-display text-xl font-bold">Pay</h2>
        <p className="mt-1 text-xs text-cocoa-soft">
          PayPal sandbox: log in with your sandbox Personal account, or pay by card. No real money moves.
        </p>
        <div className="mt-4 min-h-12" ref={box} />
        {!ready && !failed && <p className="text-sm text-cocoa-soft">Loading PayPal</p>}
        {failed && <p className="text-sm text-tomato">Could not load PayPal. Check your connection and reload.</p>}
        {status.kind === "working" && <p className="mt-3 text-sm font-semibold">{status.msg}</p>}
        {status.kind === "error" && <p className="mt-3 text-sm font-semibold text-tomato">{status.msg}</p>}
      </section>
    </div>
  );
}
