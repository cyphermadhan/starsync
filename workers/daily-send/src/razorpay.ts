// Razorpay client, duplicated from the main starsync worker's src/lib/razorpay.ts
// rather than shared — these are two separate build pipelines (see
// encryption.ts for the same pattern/reasoning). This worker is the only
// place that ever creates a Razorpay customer/subscription now: it happens
// at the day-3 payment nudge, not at signup, since the trial clock already
// started then and the mandate's start_at should align with the real
// trial_ends_at, not a fresh 5-day offset from "now".

const API_BASE = 'https://api.razorpay.com/v1';

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

export interface RazorpayCustomer {
  id: string;
}

export async function createCustomer(
  name: string,
  email: string,
  keyId: string,
  keySecret: string,
): Promise<RazorpayCustomer> {
  const res = await fetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    // Must be the string "0", not the number 0 — Razorpay's API silently
    // treats a non-string value as unset and defaults to failing instead
    // of returning the existing customer.
    body: JSON.stringify({ name, email, fail_existing: '0' }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay createCustomer failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface RazorpaySubscription {
  id: string;
  short_url: string;
}

export async function createSubscription(
  customerId: string,
  planId: string,
  startAt: number,
  keyId: string,
  keySecret: string,
): Promise<RazorpaySubscription> {
  const res = await fetch(`${API_BASE}/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: planId,
      customer_id: customerId,
      total_count: 52, // weekly plan billed indefinitely, capped at ~1 year per Razorpay's max; renew via a cron job if needed
      start_at: startAt,
      customer_notify: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay createSubscription failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function cancelSubscription(
  subscriptionId: string,
  keyId: string,
  keySecret: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cancel_at_cycle_end: 0 }),
  });
  if (!res.ok) {
    throw new Error(`Razorpay cancelSubscription failed: ${res.status} ${await res.text()}`);
  }
}
