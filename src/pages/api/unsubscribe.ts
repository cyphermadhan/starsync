import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cancelSubscription } from '../../lib/razorpay';

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return redirect('/unsubscribed?status=error');
  }

  const subscriber = await env.DB.prepare(
    'SELECT id, razorpay_subscription_id FROM subscribers WHERE unsubscribe_token = ?',
  )
    .bind(token)
    .first<{ id: string; razorpay_subscription_id: string | null }>();

  if (!subscriber) {
    return redirect('/unsubscribed?status=error');
  }

  if (subscriber.razorpay_subscription_id) {
    try {
      await cancelSubscription(subscriber.razorpay_subscription_id, env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
    } catch (err) {
      // Best-effort — e.g. Razorpay may already consider it cancelled.
      // Deleting the user's data takes priority over this succeeding.
      console.error(`Failed to cancel subscription ${subscriber.razorpay_subscription_id} on unsubscribe:`, err);
    }
  }

  // delivery_log references subscribers via a foreign key with no ON DELETE
  // CASCADE — deleting the parent row first throws a FOREIGN KEY constraint
  // error for any subscriber who's ever received an email. billing_events
  // has no such FK (by design, see schema.sql) and is deliberately kept as
  // the retained billing/audit trail.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM delivery_log WHERE subscriber_id = ?').bind(subscriber.id),
    env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(subscriber.id),
  ]);

  return redirect('/unsubscribed?status=ok');
};
