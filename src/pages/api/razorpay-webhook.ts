import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyWebhookSignature } from '../../lib/razorpay';

// Status this app tracks locally (see db/schema.sql's CHECK constraint) for
// each Razorpay subscription event. `null` means "log the event, no status
// change" — e.g. subscription.authenticated fires while still mid-trial,
// and subscription.pending is a payment retry grace period, not yet a
// definite outcome.
const STATUS_BY_EVENT: Record<string, 'active' | 'paused' | null> = {
  'subscription.authenticated': null,
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': null,
  'subscription.halted': 'paused',
  'subscription.paused': 'paused',
  'subscription.resumed': 'active',
};

// Events we actually act on — anything else (e.g. refund.* or other events
// someone enables in the Razorpay dashboard later) is acknowledged with 200
// and ignored, rather than logging a noisy "couldn't find subscription id".
const KNOWN_EVENTS = new Set([...Object.keys(STATUS_BY_EVENT), 'subscription.cancelled', 'payment.failed']);

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    subscription?: { entity?: { id?: string } };
    payment?: { entity?: { subscription_id?: string } };
  };
}

function extractSubscriptionId(body: RazorpayWebhookBody): string | null {
  return body.payload?.subscription?.entity?.id ?? body.payload?.payment?.entity?.subscription_id ?? null;
}

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const signature = request.headers.get('X-Razorpay-Signature');

  if (!signature || !(await verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = body.event;

  // Once the signature checks out, always return 200 — Razorpay retries
  // on anything else, and a transient D1 hiccup on our end shouldn't turn
  // into a retry storm. Errors are logged, not surfaced to the caller.
  if (!event || !KNOWN_EVENTS.has(event)) {
    return new Response('OK', { status: 200 });
  }

  try {
    const subscriptionId = extractSubscriptionId(body);
    if (!subscriptionId) {
      console.error(`Razorpay webhook ${event}: no subscription id in payload`);
      return new Response('OK', { status: 200 });
    }

    const subscriber = await env.DB.prepare('SELECT id FROM subscribers WHERE razorpay_subscription_id = ?')
      .bind(subscriptionId)
      .first<{ id: string }>();

    if (!subscriber) {
      // Expected when this fires for a subscription our own /api/unsubscribe
      // already cancelled-and-deleted — not necessarily an error.
      console.error(`Razorpay webhook ${event}: no subscriber for subscription ${subscriptionId}`);
      return new Response('OK', { status: 200 });
    }

    if (event === 'subscription.cancelled') {
      // Matches /api/unsubscribe's privacy stance: cancelled billing means
      // the PII row goes too, immediately, not just a status flip.
      await env.DB.batch([
        env.DB.prepare('INSERT INTO billing_events (id, subscriber_id, event_type) VALUES (?, ?, ?)').bind(
          crypto.randomUUID(),
          subscriber.id,
          event,
        ),
        env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(subscriber.id),
      ]);
    } else {
      const newStatus = STATUS_BY_EVENT[event];
      const statements = [
        env.DB.prepare('INSERT INTO billing_events (id, subscriber_id, event_type) VALUES (?, ?, ?)').bind(
          crypto.randomUUID(),
          subscriber.id,
          event,
        ),
      ];
      if (newStatus) {
        statements.push(
          env.DB.prepare("UPDATE subscribers SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(
            newStatus,
            subscriber.id,
          ),
        );
      }
      await env.DB.batch(statements);
    }
  } catch (err) {
    console.error(`Razorpay webhook ${event} handling failed:`, err);
  }

  return new Response('OK', { status: 200 });
};
