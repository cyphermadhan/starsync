// Razorpay Subscriptions client. The Plan (₹11.11/week) is created once in
// the Razorpay dashboard — its ID goes in RAZORPAY_PLAN_ID. `start_at` is set
// to 5 days from now so the mandate is authorized at signup but the first
// charge only happens once the trial ends (see plan.md for the UPI Autopay
// mandate-registration-charge caveat to confirm in your dashboard).

import { timingSafeEqual } from 'node:crypto';

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
    body: JSON.stringify({ name, email, fail_existing: 0 }),
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
  trialDays: number,
  keyId: string,
  keySecret: string,
): Promise<RazorpaySubscription> {
  const startAt = Math.floor(Date.now() / 1000) + trialDays * 24 * 60 * 60;

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

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Plain === leaks timing information byte-by-byte; a constant-time
  // compare is the standard defense for anything checking a signature.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
