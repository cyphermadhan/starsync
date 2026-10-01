import { decryptField } from './encryption';
import { generateReading } from './openai';
import { sendReadingEmail } from './resend';

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
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
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

  const [email, name, role] = await Promise.all([
    decryptField(subscriber.email_encrypted, env.ENCRYPTION_KEY),
    decryptField(subscriber.name_encrypted, env.ENCRYPTION_KEY),
    decryptField(subscriber.role_encrypted, env.ENCRYPTION_KEY),
  ]);

  const reading = await generateReading(
    { rasi: subscriber.rasi, nakshatra: subscriber.nakshatra, pada: subscriber.pada, role, date: new Date() },
    env.OPENAI_API_KEY,
  );

  await sendReadingEmail(
    { to: email, name, reading, unsubscribeToken: subscriber.unsubscribe_token },
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
