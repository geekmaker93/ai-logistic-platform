"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

const stripePromiseCache = new Map<string, Promise<Stripe | null>>();

function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  const existing = stripePromiseCache.get(publishableKey);
  if (existing) {
    return existing;
  }

  const nextPromise = loadStripe(publishableKey);
  stripePromiseCache.set(publishableKey, nextPromise);
  return nextPromise;
}

type StripeEmbeddedCheckoutProps = Readonly<{
  clientSecret: string;
  publishableKey: string;
  title: string;
  onClose: () => void;
}>;

export default function StripeEmbeddedCheckout(props: StripeEmbeddedCheckoutProps) {
  const stripePromise = props.publishableKey ? getStripePromise(props.publishableKey) : null;

  if (!stripePromise) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4">
        <section className="w-full max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-xl">
          <p className="font-semibold">Stripe publishable key missing.</p>
          <p className="mt-1">Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to render the embedded checkout.</p>
          <button
            type="button"
            onClick={props.onClose}
            className="mt-3 rounded-lg border border-amber-300 px-3 py-2 font-semibold text-amber-900 hover:bg-amber-100"
          >
            Close checkout
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4">
      <section className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/20">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Secure payment</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">{props.title}</h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </section>
    </div>
  );
}