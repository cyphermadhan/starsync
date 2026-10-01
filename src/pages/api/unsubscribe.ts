import type { APIRoute } from 'astro';
import { cancelSubscription } from '../../lib/razorpay';

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const env = locals.runtime.env;
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
    await cancelSubscription(subscriber.razorpay_subscription_id, env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
  }

  await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(subscriber.id).run();

  return redirect('/unsubscribed?status=ok');
};
