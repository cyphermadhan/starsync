// Razorpay client — this worker only ever cancels subscriptions and
// verifies webhook signatures. Creating customers/subscriptions now happens
// from workers/daily-send (see that worker's own src/razorpay.ts) at the
// day-3 payment nudge, not at signup — the Plan (₹11.11/week) is still
// created once in the Razorpay dashboard, its ID goes in RAZORPAY_PLAN_ID.

import { timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.razorpay.com/v1';

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
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
