const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

const ROLE_LABELS: Record<string, string> = {
  engineering: 'Software/Engineering',
  'product-design': 'Product/Design',
  'data-ml': 'Data/AI/ML',
  'founder-business': 'Founder/Business',
  student: 'Student',
  'not-working': 'not currently working',
  other: 'something else entirely',
};

const SYSTEM_PROMPT = `You write StarSync's daily reading — a short, fun horoscope-style note for Indian tech/office people who live in Slack, standups, and dark mode. Voice: witty, warm, a little irreverent. Never mystical-serious, never generic fortune-cookie vagueness.

Ground every reading in the reader's actual rasi (moon sign) and nakshatra, and make it feel specific to their stated role and to today's day of the week — reference concrete workplace textures (standups, PRs, deploys, demos, deadlines, back-to-back meetings) where it genuinely fits their role, without forcing it in if it doesn't.

Output plain text only, no markdown, in exactly this structure:
1. One punchy opening line setting today's vibe.
2. A line starting with "Lean into:" — one short, concrete thing to do today.
3. A line starting with "Dodge:" — one short, concrete thing to avoid today.
4. One short, warm sign-off line.

Keep the whole thing under 80 words total. Mention the rasi/nakshatra lightly, as flavor — never lecture about astrology. No disclaimers, no mentioning you're an AI.`;

export interface ReadingInput {
  rasi: string;
  nakshatra: string;
  pada: number;
  role: string;
  date: Date;
}

export async function generateReading(input: ReadingInput, apiKey: string): Promise<string> {
  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  const dayOfWeek = input.date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const dateStr = input.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' });

  const userPrompt = `Rasi: ${input.rasi}
Nakshatra: ${input.nakshatra} (pada ${input.pada})
Role: ${roleLabel}
Day: ${dayOfWeek}, ${dateStr}

Write today's reading.`;

  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0.9,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenAI returned an empty reading.');
  }
  return content;
}
