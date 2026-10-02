import { decryptField } from './encryption';
import { generateDailyContent } from './openai';
import { sendDailyEmail, sendSubscriptionEmail, sendPaymentConfirmedEmail, buildNudgeBlock } from './resend';
import { createCustomer, createSubscription, cancelSubscription } from './razorpay';

interface QueueMessage {
  subscriberId: string;
  // Set by the main worker's Razorpay webhook on subscription.authenticated.
  // Tells processSubscriber to send a short payment-confirmed email instead
  // of running the normal day-count/nudge branching.
  reason?: 'authenticated';
}

interface SubscriberRow {
  id: string;
  email_encrypted: string;
  name_encrypted: string;
  role_encrypted: string;
  rasi: string;
  nakshatra: string;
  pada: number;
  unsubscribe_token: string;
  last_sent_date: string | null;
  trial_ends_at: string;
  razorpay_customer_id: string | null;
  razorpay_subscription_id: string | null;
  razorpay_subscription_url: string | null;
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function istGreeting(now: Date): string {
  const istHour = Number(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  if (istHour >= 5 && istHour < 12) return 'Good morning';
  if (istHour >= 12 && istHour < 17) return 'Good afternoon';
  if (istHour >= 17 && istHour < 21) return 'Good evening';
  return 'Good night';
}

function formatIstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
}

// UTC calendar-date difference (date-only, matching todayUtcDateString's
// precedent — not time-of-day) between today and trial_ends_at. Negative =
// still in trial, 0 = the last trial day, positive = past it.
function daysSinceTrialEnd(trialEndsAtIso: string, todayUtcDateStr: string): number {
  const trialEndsAtMs = new Date(`${trialEndsAtIso.slice(0, 10)}T00:00:00Z`).getTime();
  const todayMs = new Date(`${todayUtcDateStr}T00:00:00Z`).getTime();
  return Math.round((todayMs - trialEndsAtMs) / 86400000);
}

export default {
  // Runs every 15 minutes. Deliberately does nothing but query + enqueue —
  // the OpenAI call and email send happen in the queue consumer below, well
  // outside this handler's CPU budget.
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime);
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const windowEnd = (minuteOfDay + 15) % 1440;
    const today = todayUtcDateString();

    const query =
      windowEnd > minuteOfDay
        ? `SELECT id FROM subscribers
           WHERE status IN ('trial', 'active')
             AND preferred_send_minute_utc >= ?1 AND preferred_send_minute_utc < ?2
             AND (last_sent_date IS NULL OR last_sent_date != ?3)`
        : `SELECT id FROM subscribers
           WHERE status IN ('trial', 'active')
             AND (preferred_send_minute_utc >= ?1 OR preferred_send_minute_utc < ?2)
             AND (last_sent_date IS NULL OR last_sent_date != ?3)`;

    const { results } = await env.DB.prepare(query).bind(minuteOfDay, windowEnd, today).all<{ id: string }>();

    for (const row of results) {
      await env.DAILY_SEND_QUEUE.send({ subscriberId: row.id });
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processSubscriber(message.body.subscriberId, env, message.body.reason);
        message.ack();
      } catch (err) {
        console.error(`Failed to process subscriber ${message.body.subscriberId}:`, err);
        message.retry();
      }
    }
  },
};

async function markSent(subscriberId: string, env: Env): Promise<void> {
  const today = todayUtcDateString();
  await env.DB.batch([
    env.DB.prepare('UPDATE subscribers SET last_sent_date = ? WHERE id = ?').bind(today, subscriberId),
    env.DB.prepare('INSERT INTO delivery_log (id, subscriber_id, status) VALUES (?, ?, ?)').bind(
      crypto.randomUUID(),
      subscriberId,
      'sent',
    ),
  ]);
}

// Creates the Razorpay customer + subscription on first use (day 3's nudge,
// usually), persists it, and returns the checkout url. Later calls (day 5,
// day 6/7) just reuse the stored url instead of creating a second
// subscription. start_at aligns with the real trial_ends_at — the trial
// clock already started at signup, not from whenever this happens to run —
// except Razorpay rejects a start_at in the past, which trial_ends_at
// already is by day 6/7 if nothing created a subscription on day 3 or 5
// (e.g. a sustained Razorpay outage on both of those days). Clamped
// forward with a small buffer in that case.
async function ensureRazorpaySubscription(
  subscriber: SubscriberRow,
  email: string,
  name: string,
  env: Env,
): Promise<string> {
  if (subscriber.razorpay_subscription_url) {
    return subscriber.razorpay_subscription_url;
  }

  const customer = await createCustomer(name, email, env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
  const trialEndsAtUnix = Math.floor(new Date(subscriber.trial_ends_at).getTime() / 1000);
  const startAt = Math.max(trialEndsAtUnix, Math.floor(Date.now() / 1000) + 300);
  const subscription = await createSubscription(
    customer.id,
    env.RAZORPAY_PLAN_ID,
    startAt,
    env.RAZORPAY_KEY_ID,
    env.RAZORPAY_KEY_SECRET,
  );

  await env.DB.prepare(
    'UPDATE subscribers SET razorpay_customer_id = ?, razorpay_subscription_id = ?, razorpay_subscription_url = ? WHERE id = ?',
  )
    .bind(customer.id, subscription.id, subscription.short_url, subscriber.id)
    .run();

  return subscription.short_url;
}

// Mirrors the same cancel-then-delete pattern already in the main worker's
// /api/signup (abandoned-checkout cleanup) and /api/unsubscribe.
async function expireSubscriber(subscriber: SubscriberRow, env: Env): Promise<void> {
  if (subscriber.razorpay_subscription_id) {
    try {
      await cancelSubscription(subscriber.razorpay_subscription_id, env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
    } catch (err) {
      console.error(`Failed to cancel expired subscription ${subscriber.razorpay_subscription_id}:`, err);
    }
  }
  // delivery_log has a hard FK to subscribers (no CASCADE) — every expired
  // subscriber has at least one row there (the readings they did get during
  // the trial), so deleting subscribers first throws a FOREIGN KEY error.
  // billing_events has no such FK by design (see schema.sql), but is
  // irrelevant here anyway since this function only runs when it's empty.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM delivery_log WHERE subscriber_id = ?').bind(subscriber.id),
    env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(subscriber.id),
  ]);
}

async function processSubscriber(subscriberId: string, env: Env, reason?: 'authenticated'): Promise<void> {
  const subscriber = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?')
    .bind(subscriberId)
    .first<SubscriberRow>();

  if (!subscriber) {
    console.error(`Subscriber ${subscriberId} not found — skipping.`);
    return;
  }

  // Guards against a duplicate send on the same day — the regular cron
  // query already filters this, but webhook-triggered enqueues (the
  // payment-confirmed email, and the day-6/7 grace emails below) bypass
  // that query, and Razorpay webhooks can be retried/delivered more than
  // once.
  if (subscriber.last_sent_date === todayUtcDateString()) {
    console.log(`Subscriber ${subscriberId} already sent today — skipping duplicate.`);
    return;
  }

  const [email, name, role] = await Promise.all([
    decryptField(subscriber.email_encrypted, env.ENCRYPTION_KEY),
    decryptField(subscriber.name_encrypted, env.ENCRYPTION_KEY),
    decryptField(subscriber.role_encrypted, env.ENCRYPTION_KEY),
  ]);

  if (reason === 'authenticated') {
    await sendPaymentConfirmedEmail(
      {
        to: email,
        name,
        nextChargeDateStr: formatIstDate(subscriber.trial_ends_at),
        unsubscribeToken: subscriber.unsubscribe_token,
      },
      env.RESEND_API_KEY,
    );
    await markSent(subscriberId, env);
    return;
  }

  // billing_events only ever gets a row via a real Razorpay webhook — its
  // absence means this subscriber has never authenticated a mandate, which
  // is what the day-count nudge/grace/expire sequence below is for. Once
  // they have authenticated (any day), none of that applies anymore —
  // status alone can't tell us this, since it only flips to 'active' once
  // the first real charge posts at trial_ends_at, not at authentication.
  const everAuthenticated = await env.DB.prepare('SELECT 1 FROM billing_events WHERE subscriber_id = ? LIMIT 1')
    .bind(subscriberId)
    .first();

  let nudgeHtml: string | undefined;

  if (!everAuthenticated) {
    const daysSinceEnd = daysSinceTrialEnd(subscriber.trial_ends_at, todayUtcDateString());

    if (daysSinceEnd >= 5) {
      await expireSubscriber(subscriber, env);
      return;
    }

    if (daysSinceEnd === 3 || daysSinceEnd === 4) {
      // Silent grace buffer — no email, data not yet deleted.
      return;
    }

    if (daysSinceEnd === 1 || daysSinceEnd === 2) {
      let checkoutUrl: string;
      try {
        checkoutUrl = await ensureRazorpaySubscription(subscriber, email, name, env);
      } catch (err) {
        // Self-heals: last_sent_date isn't touched, so tomorrow's cron
        // pass just tries again at daysSinceEnd+1 instead of looping via
        // queue retry on a persistent Razorpay outage.
        console.error(`Subscriber ${subscriberId}: failed to prepare grace-period checkout link:`, err);
        return;
      }
      await sendSubscriptionEmail(
        {
          to: email,
          name,
          checkoutUrl,
          trialEndsAtDateStr: formatIstDate(subscriber.trial_ends_at),
          unsubscribeToken: subscriber.unsubscribe_token,
        },
        env.RESEND_API_KEY,
      );
      await markSent(subscriberId, env);
      return;
    }

    if (daysSinceEnd === -2 || daysSinceEnd === 0) {
      try {
        const checkoutUrl = await ensureRazorpaySubscription(subscriber, email, name, env);
        const headline = daysSinceEnd === -2 ? 'Your free trial ends in 2 days' : 'Your free trial ends today';
        nudgeHtml = buildNudgeBlock(checkoutUrl, headline, 'Add payment to keep your daily readings coming — no interruption.');
      } catch (err) {
        // Non-fatal — the reading is the higher-priority deliverable; send
        // it without the nudge this time and let the next nudge day retry.
        console.error(`Subscriber ${subscriberId}: failed to prepare payment nudge, sending reading without it:`, err);
      }
    }
    // Any other value (normal trial days 1/2/4) falls through to the
    // regular reading below with no nudge.
  }

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  const greeting = istGreeting(now);

  const content = await generateDailyContent(
    { rasi: subscriber.rasi, nakshatra: subscriber.nakshatra, pada: subscriber.pada, role, dayOfWeek, dateStr },
    env.OPENAI_API_KEY,
  );

  await sendDailyEmail(
    { to: email, name, dayOfWeek, dateStr, greeting, content, unsubscribeToken: subscriber.unsubscribe_token, nudgeHtml },
    env.RESEND_API_KEY,
  );

  await markSent(subscriberId, env);
}
