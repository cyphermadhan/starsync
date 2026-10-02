// Content generator for the instant free preview reading (idea-v2) — a
// permanent, shared cache keyed by chart combo (src/pages/api/preview.ts),
// not a per-user per-day generation like workers/daily-send/src/openai.ts.
// Deliberately separate from that module: no role, no day-of-week/date
// context, framed as an evergreen read rather than "today's" reading.

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

const RASI_ELEMENTS: Record<string, string> = {
  Mesha: 'Fire',
  Simha: 'Fire',
  Dhanu: 'Fire',
  Vrishabha: 'Earth',
  Kanya: 'Earth',
  Makara: 'Earth',
  Mithuna: 'Air',
  Tula: 'Air',
  Kumbha: 'Air',
  Karka: 'Water',
  Vrischika: 'Water',
  Meena: 'Water',
};

const SYSTEM_PROMPT = `You write a short, evergreen "find your vibe" snapshot for StarSync, based on someone's rasi (moon sign), nakshatra, and element. Voice: a brutally honest, funny friend who happens to know astrology. Never mystical-serious, never generic fortune-cookie vagueness, never corporate.

This is NOT about "today" — it's a general read on their energy and how they move through life based on their chart, true any day someone reads it. Ground everything in their actual rasi, nakshatra, and element. Do not reference work, a job, or a profession anywhere — nothing about this reader's role is known.

Respond with ONLY a JSON object, no markdown, no commentary, in exactly this shape:
{
  "hook": "One short, blunt, punchy line — reads like a philosophical text message from a brutally honest friend. Declarative or imperative, not a question.",
  "coreEnergy": "1-2 sentences on their baseline emotional/psychological energy — how it generally feels to be them, not tied to any specific day.",
  "loveRelationships": "1-2 sentences on how they tend to show up in love/dating/relationships — their pattern, not a day-specific prediction. Be specific and a little cheeky, not generic.",
  "socialDynamics": "1-2 sentences about how they tend to click or clash with other elements in friendships/family. The reader does NOT know astrology jargon, so never drop a bare element name like 'Water friends' or 'Earth signs' — always fuse the trait into the same phrase instead, e.g. 'your intuitive, feelings-first Water friends' or 'your steady, practical-minded Earth friends' (Fire = bold/blunt/impulsive, Earth = grounded/practical/steady, Air = chatty/social/idea-driven, Water = emotional/intuitive/sensitive). Name one element they lean on and, if it fits, one to be cautious with.",
  "dos": ["2-3 short imperative phrases, each under 6 words, general life/relationship advice"],
  "donts": ["2-3 short imperative phrases, each under 6 words, general life/relationship advice"],
  "quote": "One original, short aphorism in the same voice. NOT a real quote from any real person, book, song, or media — write it fresh, as if it's wisdom you just came up with on the spot."
}

Keep every field short and scannable. No disclaimers, no mentioning you're an AI, no astrology jargon-dumps, nothing about work or profession.`;

export interface PreviewContent {
  hook: string;
  coreEnergy: string;
  loveRelationships: string;
  socialDynamics: string;
  dos: string[];
  donts: string[];
  quote: string;
}

export interface PreviewContentInput {
  rasi: string;
  nakshatra: string;
  pada: number;
}

function assertPreviewContent(value: unknown): PreviewContent {
  const v = value as Partial<PreviewContent> | null;
  if (
    !v ||
    typeof v.hook !== 'string' ||
    typeof v.coreEnergy !== 'string' ||
    typeof v.loveRelationships !== 'string' ||
    typeof v.socialDynamics !== 'string' ||
    !Array.isArray(v.dos) ||
    !Array.isArray(v.donts) ||
    typeof v.quote !== 'string'
  ) {
    throw new Error(`OpenAI returned an unexpected shape: ${JSON.stringify(value)}`);
  }
  return v as PreviewContent;
}

export async function generatePreviewContent(input: PreviewContentInput, apiKey: string): Promise<PreviewContent> {
  const element = RASI_ELEMENTS[input.rasi] ?? 'Unknown';

  const userPrompt = `Rasi: ${input.rasi} (${element} sign)
Nakshatra: ${input.nakshatra} (pada ${input.pada})

Write this chart's evergreen vibe snapshot as JSON.`;

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
      response_format: { type: 'json_object' },
      max_tokens: 450,
      temperature: 0.9,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('OpenAI returned an empty response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI response was not valid JSON: ${raw}`);
  }

  return assertPreviewContent(parsed);
}
