"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeOrders } from "./actions";

/** Removes one order, or all of the shopper's orders when no orderId is given. */
export function RemoveOrders({ orderId, className = "" }: { orderId?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const label = orderId ? "Remove" : "Clear all my orders";
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() => {
        const msg = orderId
          ? "Remove this order from My orders? The PayPal sandbox payment and any refund are not changed."
          : "Remove all your orders and recall messages from this demo store? The PayPal sandbox payments and refunds are not changed.";
        if (!confirm(msg)) return;
        start(async () => {
          await removeOrders(orderId);
          router.replace("/orders");
          router.refresh();
        });
      }}
    >
      {pending ? "Removing" : label}
    </button>
  );
}
