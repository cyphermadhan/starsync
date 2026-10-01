const RESEND_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'StarSync <hello@starsync.familyfirstapps.com>';

export interface SendReadingInput {
  to: string;
  name: string;
  reading: string;
  unsubscribeToken: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(input: SendReadingInput): string {
  const unsubscribeUrl = `https://starsync.familyfirstapps.com/api/unsubscribe?token=${encodeURIComponent(input.unsubscribeToken)}`;
  const safeName = escapeHtml(input.name.split(' ')[0] ?? input.name);
  const safeReading = escapeHtml(input.reading).replace(/\n/g, '<br />');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#08080d;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
      <div style="font-weight:700;font-size:18px;color:#f2f1f6;margin-bottom:24px;">
        Star<span style="color:#33e6b0;">Sync</span>
      </div>
      <p style="color:#a3a1b3;font-size:14px;margin:0 0 16px;">Hey ${safeName},</p>
      <div style="background:#111118;border:1px solid #23232f;border-radius:16px;padding:24px;color:#f2f1f6;font-size:15px;line-height:1.7;">
        ${safeReading}
      </div>
      <p style="color:#55536a;font-size:12px;margin-top:32px;text-align:center;">
        <a href="${unsubscribeUrl}" style="color:#55536a;">Unsubscribe</a> ·
        <a href="https://starsync.familyfirstapps.com/privacy" style="color:#55536a;">Privacy</a>
      </p>
    </div>
  </body>
</html>`;
}

export async function sendReadingEmail(input: SendReadingInput, apiKey: string): Promise<void> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: input.to,
      subject: "Today's raasi palan ✦",
      html: buildHtml(input),
      text: `${input.reading}\n\nUnsubscribe: https://starsync.familyfirstapps.com/api/unsubscribe?token=${input.unsubscribeToken}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend request failed: ${res.status} ${await res.text()}`);
  }
}
