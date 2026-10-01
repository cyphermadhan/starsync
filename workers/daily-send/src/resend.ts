import type { DailyContent } from './openai';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'StarSync <hello@starsync.familyfirstapps.com>';
const ASSETS_BASE = 'https://starsync.familyfirstapps.com/email';

const TEXT = '#121212';
const MUTED = 'rgba(18,18,18,0.64)';
// No @font-face / Google Fonts link — Gmail (web + app, likely most of our
// subscribers) never loads custom web fonts in email, so it's dead weight
// there. This system-font stack renders as Roboto on Android/Gmail and San
// Francisco on Apple Mail — each platform's own modern sans, close in spirit
// to the Figma's Google Sans Flex.
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`;

export interface SendDailyEmailInput {
  to: string;
  name: string;
  dayOfWeek: string;
  dateStr: string;
  greeting: string;
  content: DailyContent;
  unsubscribeToken: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function section(icon: string, iconGap: number, title: string, body: string): string {
  return `
      <div style="margin-top:40px;">
        <div style="display:flex;align-items:center;">
          <img src="${ASSETS_BASE}/${icon}.png" width="20" height="20" alt="" style="display:block;flex-shrink:0;" />
          <p class="text-main" style="margin:0;padding-left:${iconGap}px;color:${TEXT};font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:-0.021px;">${title}</p>
        </div>
        <p class="text-main" style="margin:8px 0 0;color:${TEXT};font-family:${FONT};font-size:14px;font-weight:400;line-height:1.4;letter-spacing:-0.021px;">${body}</p>
      </div>`;
}

function list(items: string[]): string {
  return items
    .map(
      (item) =>
        `<li style="margin:0;padding:0;line-height:1.4;">${escapeHtml(item)}</li>`,
    )
    .join('');
}

function listSection(icon: string, title: string, items: string[]): string {
  return `
      <div style="margin-top:40px;">
        <div style="display:flex;align-items:center;">
          <img src="${ASSETS_BASE}/${icon}.png" width="20" height="20" alt="" style="display:block;flex-shrink:0;" />
          <p class="text-main" style="margin:0;padding-left:10px;color:${TEXT};font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:-0.021px;">${title}</p>
        </div>
        <ul class="text-main" style="margin:8px 0 0;padding-left:21px;color:${TEXT};font-family:${FONT};font-size:14px;font-weight:400;letter-spacing:-0.021px;">${list(items)}</ul>
      </div>`;
}

function styleBlock(): string {
  // Gmail Android ignores this media query entirely and does its own partial
  // auto-invert instead (darkens backgrounds, leaves images untouched) — so
  // this only actually fires in Apple/iOS Mail, which does respect it. The
  // logo is handled separately (a self-contained white chip baked into the
  // image) specifically because it can't depend on any client's dark-mode
  // support to render correctly.
  return `
    <style>
      @media (prefers-color-scheme: dark) {
        .email-bg { background:#08080d !important; }
        .text-main { color:#f2f1f6 !important; }
        .text-muted { color:#a3a1b3 !important; }
      }
    </style>`;
}

function buildHtml(input: SendDailyEmailInput): string {
  const unsubscribeUrl = `https://starsync.familyfirstapps.com/api/unsubscribe?token=${encodeURIComponent(input.unsubscribeToken)}`;
  const firstName = escapeHtml(input.name.split(' ')[0] ?? input.name);
  const c = input.content;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    ${styleBlock()}
  </head>
  <body class="email-bg" style="margin:0;padding:0;background:#ffffff;font-family:${FONT};">
    ${styleBlock()}
    <div style="max-width:600px;margin:0 auto;padding:24px;">

      <div style="text-align:center;">
        <img src="${ASSETS_BASE}/starsync-logo-chip.png" width="154" height="57" alt="StarSync" style="display:inline-block;" />
      </div>

      <div style="margin-top:24px;text-align:center;">
        <p class="text-main" style="margin:0;color:${TEXT};font-family:${FONT};font-size:18px;font-weight:400;line-height:1.33;letter-spacing:-0.027px;">${escapeHtml(input.greeting)}, ${firstName}!</p>
        <p class="text-muted" style="margin:0;color:${MUTED};font-family:${FONT};font-size:14px;font-weight:400;letter-spacing:-0.021px;">${escapeHtml(input.dayOfWeek)}, ${escapeHtml(input.dateStr)}</p>
      </div>

      <p class="text-main" style="margin:24px 0 0;color:${TEXT};font-family:${FONT};font-size:18px;font-weight:600;line-height:1.33;letter-spacing:-0.027px;text-align:center;">~ ${escapeHtml(c.hook)} ~</p>

      ${section('core-energy', 8, 'Your core energy', escapeHtml(c.coreEnergy))}
      ${section('work-productivity', 8, 'Work &amp; productivity', escapeHtml(c.workProductivity))}
      ${section('love-relationship', 10, 'Love &amp; relationships', escapeHtml(c.loveRelationships))}
      ${section('social-dynamics', 10, 'Social dynamics', escapeHtml(c.socialDynamics))}
      ${listSection('dos', 'Do&rsquo;s', c.dos)}
      ${listSection('donts', 'Don&rsquo;ts', c.donts)}

      <p class="text-muted" style="margin:40px 0 0;color:${MUTED};font-family:${FONT};font-size:16px;font-style:italic;line-height:1.5;letter-spacing:-0.024px;text-align:center;">&quot;${escapeHtml(c.quote)}&quot;</p>

      <p style="margin:40px 0 0;text-align:center;">
        <a href="${unsubscribeUrl}" class="text-muted" style="color:${MUTED};font-family:${FONT};font-size:12px;text-decoration:underline dotted;">Unsubscribe</a>
        <span style="display:inline-block;width:24px;"></span>
        <a href="https://starsync.familyfirstapps.com/privacy" class="text-muted" style="color:${MUTED};font-family:${FONT};font-size:12px;text-decoration:underline dotted;">Privacy</a>
      </p>
    </div>
  </body>
</html>`;
}

function buildText(input: SendDailyEmailInput): string {
  const c = input.content;
  return `${input.greeting}, ${input.name}!
${input.dayOfWeek}, ${input.dateStr}

~ ${c.hook} ~

YOUR CORE ENERGY
${c.coreEnergy}

WORK & PRODUCTIVITY
${c.workProductivity}

LOVE & RELATIONSHIPS
${c.loveRelationships}

SOCIAL DYNAMICS
${c.socialDynamics}

DO'S
${c.dos.map((d) => `- ${d}`).join('\n')}

DON'TS
${c.donts.map((d) => `- ${d}`).join('\n')}

"${c.quote}"

Unsubscribe: https://starsync.familyfirstapps.com/api/unsubscribe?token=${input.unsubscribeToken}`;
}

export async function sendDailyEmail(input: SendDailyEmailInput, apiKey: string): Promise<void> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: input.to,
      subject: "Today's Sync",
      html: buildHtml(input),
      text: buildText(input),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend request failed: ${res.status} ${await res.text()}`);
  }
}
