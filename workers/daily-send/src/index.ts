import { decryptField } from './encryption';
import { generateDailyContent } from './openai';
import { sendDailyEmail } from './resend';

interface QueueMessage {
  subscriberId: string;
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
        await processSubscriber(message.body.subscriberId, env);
        message.ack();
      } catch (err) {
        console.error(`Failed to process subscriber ${message.body.subscriberId}:`, err);
        message.retry();
      }
    }
  },
};

async function processSubscriber(subscriberId: string, env: Env): Promise<void> {
  const subscriber = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?')
    .bind(subscriberId)
    .first<SubscriberRow>();

  if (!subscriber) {
    console.error(`Subscriber ${subscriberId} not found — skipping.`);
    return;
  }

  // Guards against a duplicate send on the same day — the regular cron
  // query already filters this, but the webhook-triggered "welcome"
  // reading enqueues directly, bypassing that query, and Razorpay webhooks
  // can be retried/delivered more than once.
  if (subscriber.last_sent_date === todayUtcDateString()) {
    console.log(`Subscriber ${subscriberId} already sent today — skipping duplicate.`);
    return;
  }

  const [email, name, role] = await Promise.all([
    decryptField(subscriber.email_encrypted, env.ENCRYPTION_KEY),
    decryptField(subscriber.name_encrypted, env.ENCRYPTION_KEY),
    decryptField(subscriber.role_encrypted, env.ENCRYPTION_KEY),
  ]);

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  const greeting = istGreeting(now);

  const content = await generateDailyContent(
    { rasi: subscriber.rasi, nakshatra: subscriber.nakshatra, pada: subscriber.pada, role, dayOfWeek, dateStr },
    env.OPENAI_API_KEY,
  );

  await sendDailyEmail(
    { to: email, name, dayOfWeek, dateStr, greeting, content, unsubscribeToken: subscriber.unsubscribe_token },
    env.RESEND_API_KEY,
  );

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
