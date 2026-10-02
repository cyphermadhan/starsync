import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sha256Hex } from '../../lib/encryption';
import { geocodePlaceOfBirth, toUtcDate } from '../../lib/geocoding';
import { computeVedicChart } from '../../lib/vedic';
import { generatePreviewContent, type PreviewContent } from '../../lib/preview-openai';

const MAX_FREE_TRIES_PER_DAY = 3;
const TIME_RE = /^\d{2}:\d{2}$/;

interface PreviewPayload {
  dob: string;
  tob: string;
  pob: string;
}

function validate(payload: Partial<PreviewPayload>): string | null {
  if (!payload.dob) return 'Date of birth is required.';
  if (!payload.tob || !TIME_RE.test(payload.tob)) return 'Time of birth is required.';
  if (!payload.pob?.trim()) return 'Place of birth is required.';
  return null;
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  // Burst protection — separate from the per-day quota below, which the
  // native binding can't express (max period is 60s).
  const { success } = await env.PREVIEW_RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return Response.json({ error: 'Too many requests. Please try again in a minute.' }, { status: 429 });
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<PreviewPayload>;
  const validationError = validate(payload);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }
  const data = payload as PreviewPayload;

  // IP is hashed, never stored raw — same discipline as email_hash
  // elsewhere in this schema.
  const ipHash = await sha256Hex(ip);
  const quotaDate = todayUtcDateString();

  const quota = await env.DB.prepare('SELECT tries_used FROM preview_quota WHERE ip_hash = ? AND quota_date = ?')
    .bind(ipHash, quotaDate)
    .first<{ tries_used: number }>();

  if (quota && quota.tries_used >= MAX_FREE_TRIES_PER_DAY) {
    return Response.json(
      { error: "You've used your 3 free tries for today. Subscribe to get a reading every day." },
      { status: 429 },
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

  const cached = await env.DB.prepare(
    'SELECT content FROM preview_readings WHERE rasi = ? AND nakshatra = ? AND pada = ?',
  )
    .bind(chart.rasi, chart.nakshatra, chart.pada)
    .first<{ content: string }>();

  let content: PreviewContent;
  if (cached) {
    content = JSON.parse(cached.content);
  } else {
    try {
      content = await generatePreviewContent(chart, env.OPENAI_API_KEY);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Could not generate your reading.' },
        { status: 502 },
      );
    }
    // INSERT OR IGNORE handles the rare race of two first-time requests for
    // the same chart combo landing concurrently — whichever lost just reads
    // back the winner's row below, so the response is always consistent.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO preview_readings (id, rasi, nakshatra, pada, content) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), chart.rasi, chart.nakshatra, chart.pada, JSON.stringify(content))
      .run();
    const stored = await env.DB.prepare(
      'SELECT content FROM preview_readings WHERE rasi = ? AND nakshatra = ? AND pada = ?',
    )
      .bind(chart.rasi, chart.nakshatra, chart.pada)
      .first<{ content: string }>();
    if (stored) content = JSON.parse(stored.content);
  }

  await env.DB.prepare(
    `INSERT INTO preview_quota (ip_hash, quota_date, tries_used) VALUES (?, ?, 1)
     ON CONFLICT (ip_hash, quota_date) DO UPDATE SET tries_used = tries_used + 1`,
  )
    .bind(ipHash, quotaDate)
    .run();

  return Response.json({ rasi: chart.rasi, nakshatra: chart.nakshatra, pada: chart.pada, content });
};
