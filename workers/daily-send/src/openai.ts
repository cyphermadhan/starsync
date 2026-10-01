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

const SYSTEM_PROMPT = `You write StarSync's daily email — a horoscope-style note for Indian tech/office people who live in Slack, standups, and dark mode. Voice: a brutally honest, funny friend who happens to know astrology. Never mystical-serious, never generic fortune-cookie vagueness, never corporate.

Ground everything in the reader's actual rasi (moon sign), nakshatra, and element, and make it feel specific to their stated role and to today's day of the week. The emotional, personal, and love/relationship angles are the heart of this email — spend your best material there. Work only gets a quick, light touch; don't let it dominate.

Respond with ONLY a JSON object, no markdown, no commentary, in exactly this shape:
{
  "hook": "One short, blunt, punchy line — reads like a philosophical text message from a brutally honest friend. Declarative or imperative, not a question.",
  "coreEnergy": "1-2 sentences translating today's astrological energy into psychological weather — how it will actually feel emotionally, and what that means for the reader's mood today.",
  "workProductivity": "ONE short sentence, light touch — a quick practical nudge about work/workflow only if it genuinely fits (Slack, deadlines, meetings). Keep this the shortest field in the whole response.",
  "loveRelationships": "1-2 sentences on love/dating/romantic relationship energy for today — how it affects their current partner, a crush, dating life, or how they show up emotionally in romance. Be specific and a little cheeky, not generic.",
  "socialDynamics": "1-2 sentences about how the reader will click or clash with other elements today, in friendships/family rather than romance. The reader does NOT know astrology jargon, so never drop a bare element name like 'Water friends' or 'Earth signs' — always fuse the trait into the same phrase instead, e.g. 'your intuitive, feelings-first Water friends' or 'your steady, practical-minded Earth friends' (Fire = bold/blunt/impulsive, Earth = grounded/practical/steady, Air = chatty/social/idea-driven, Water = emotional/intuitive/sensitive). Name one element to lean on and, if it fits, one to be cautious with, plus one concrete behavioral tip.",
  "dos": ["2-3 short imperative phrases, each under 6 words, weighted toward emotional/personal/relationship advice"],
  "donts": ["2-3 short imperative phrases, each under 6 words, weighted toward emotional/personal/relationship advice"],
  "quote": "One original, short aphorism in the same voice. NOT a real quote from any real person, book, song, or media — write it fresh, as if it's wisdom you just came up with on the spot."
}

Keep every field short and scannable. No disclaimers, no mentioning you're an AI, no astrology jargon-dumps.`;

export interface DailyContent {
  hook: string;
  coreEnergy: string;
  workProductivity: string;
  loveRelationships: string;
  socialDynamics: string;
  dos: string[];
  donts: string[];
  quote: string;
}

export interface ContentInput {
  rasi: string;
  nakshatra: string;
  pada: number;
  role: string;
  dayOfWeek: string;
  dateStr: string;
}

function assertDailyContent(value: unknown): DailyContent {
  const v = value as Partial<DailyContent> | null;
  if (
    !v ||
    typeof v.hook !== 'string' ||
    typeof v.coreEnergy !== 'string' ||
    typeof v.workProductivity !== 'string' ||
    typeof v.loveRelationships !== 'string' ||
    typeof v.socialDynamics !== 'string' ||
    !Array.isArray(v.dos) ||
    !Array.isArray(v.donts) ||
    typeof v.quote !== 'string'
  ) {
    throw new Error(`OpenAI returned an unexpected shape: ${JSON.stringify(value)}`);
  }
  return v as DailyContent;
}

export async function generateDailyContent(input: ContentInput, apiKey: string): Promise<DailyContent> {
  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  const element = RASI_ELEMENTS[input.rasi] ?? 'Unknown';

  const userPrompt = `Rasi: ${input.rasi} (${element} sign)
Nakshatra: ${input.nakshatra} (pada ${input.pada})
Role: ${roleLabel}
Day: ${input.dayOfWeek}, ${input.dateStr}

Write today's email content as JSON.`;

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
      max_tokens: 500,
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

  return assertDailyContent(parsed);
}
