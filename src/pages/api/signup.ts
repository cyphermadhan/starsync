import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { encryptField, generateToken, sha256Hex } from '../../lib/encryption';
import { geocodePlaceOfBirth, toUtcDate } from '../../lib/geocoding';
import { computeVedicChart } from '../../lib/vedic';
import { createCustomer, createSubscription } from '../../lib/razorpay';

const TRIAL_DAYS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^\d{2}:\d{2}$/;
// Must match the signup form's <option value="..."> list exactly, and the
// ROLE_LABELS keys in workers/daily-send/src/openai.ts — this is the only
// thing standing between a direct API call and arbitrary text flowing
// unescaped into the daily OpenAI prompt.
const VALID_ROLES = new Set([
  'engineering',
  'product-design',
  'data-ml',
  'founder-business',
  'student',
  'not-working',
  'other',
]);

interface SignupPayload {
  name: string;
  email: string;
  dob: string;
  tob: string;
  pob: string;
  role: string;
  sendTime: string;
  consent: string;
}

function validate(payload: Partial<SignupPayload>): string | null {
  if (!payload.name?.trim()) return 'Name is required.';
  if (!payload.email || !EMAIL_RE.test(payload.email)) return 'A valid email is required.';
  if (!payload.dob) return 'Date of birth is required.';
  if (!payload.tob || !TIME_RE.test(payload.tob)) return 'Time of birth is required.';
  if (!payload.pob?.trim()) return 'Place of birth is required.';
  if (!payload.role || !VALID_ROLES.has(payload.role)) return 'Please pick what your day looks like.';
  if (!payload.sendTime || !TIME_RE.test(payload.sendTime)) return 'Preferred send time is required.';
  if (payload.consent !== 'on') return 'You need to agree to the Privacy Policy to continue.';
  return null;
}

function sendMinuteUtc(sendTimeIst: string): number {
  const [hour, minute] = sendTimeIst.split(':').map(Number);
  // Signup form collects IST local time (this product only serves India); IST is UTC+5:30.
  const totalMinutesIst = hour * 60 + minute;
  return (totalMinutesIst - 5 * 60 - 30 + 1440) % 1440;
}

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.SIGNUP_RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return Response.json({ error: 'Too many signup attempts. Please try again in a minute.' }, { status: 429 });
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<SignupPayload>;

  const validationError = validate(payload);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }
  const data = payload as SignupPayload;

  const emailHash = await sha256Hex(data.email);
  const existing = await env.DB.prepare('SELECT id FROM subscribers WHERE email_hash = ?')
    .bind(emailHash)
    .first();
  if (existing) {
    return Response.json(
      { error: 'You already have a StarSync subscription with this email.' },
      { status: 409 },
    );
  }

  let chart: { rasi: string; nakshatra: string; pada: number };
  try {
    const coords = await geocodePlaceOfBirth(data.pob);
    const birthUtc = toUtcDate(data.dob, data.tob, coords);
    chart = computeVedicChart(birthUtc);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not calculate your birth chart.' },
      { status: 502 },
    );
  }

  let subscriptionId: string;
  let customerId: string;
  try {
    const customer = await createCustomer(data.name, data.email, env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
    customerId = customer.id;
    const subscription = await createSubscription(
      customer.id,
      env.RAZORPAY_PLAN_ID,
      TRIAL_DAYS,
      env.RAZORPAY_KEY_ID,
      env.RAZORPAY_KEY_SECRET,
    );
    subscriptionId = subscription.id;
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not set up billing.' },
      { status: 502 },
    );
  }

  const key = env.ENCRYPTION_KEY;
  const [nameEnc, emailEnc, dobEnc, tobEnc, pobEnc, roleEnc] = await Promise.all([
    encryptField(data.name, key),
    encryptField(data.email, key),
    encryptField(data.dob, key),
    encryptField(data.tob, key),
    encryptField(data.pob, key),
    encryptField(data.role, key),
  ]);

  const id = crypto.randomUUID();
  const unsubscribeToken = generateToken();
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO subscribers
      (id, email_encrypted, email_hash, name_encrypted, dob_encrypted, tob_encrypted, pob_encrypted,
       role_encrypted, rasi, nakshatra, pada, preferred_send_minute_utc, status, trial_ends_at,
       razorpay_customer_id, razorpay_subscription_id, unsubscribe_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      emailEnc,
      emailHash,
      nameEnc,
      dobEnc,
      tobEnc,
      pobEnc,
      roleEnc,
      chart.rasi,
      chart.nakshatra,
      chart.pada,
      sendMinuteUtc(data.sendTime),
      trialEndsAt,
      customerId,
      subscriptionId,
      unsubscribeToken,
    )
    .run();

  return Response.json({
    subscriptionId,
    razorpayKeyId: env.RAZORPAY_KEY_ID,
    name: data.name,
    email: data.email,
  });
};
