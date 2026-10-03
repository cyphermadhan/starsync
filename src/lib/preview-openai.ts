// Content generator for the instant free preview reading (idea-v2) — a
// permanent, shared cache keyed by chart combo (src/pages/api/preview.ts),
// not a per-user per-day generation like workers/daily-send/src/openai.ts.
// Deliberately separate from that module: no role, no real day-of-week/date
// input. The copy is still *written* as a "today" horoscope (to match the
// email's voice) even though the same cached text is reused on every future
// day for that chart combo — intentional, this is a for-fun preview, not a
// literal day-accurate forecast.

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

const SYSTEM_PROMPT = `You write a short "today's vibe" snapshot for StarSync, based on someone's rasi (moon sign), nakshatra, and element. Voice: a brutally honest, funny friend who happens to know astrology. Never mystical-serious, never generic fortune-cookie vagueness, never corporate.

Frame every field as what's happening for them TODAY — write like a daily horoscope ("today's energy pulls you toward...", "expect a bit of..."), never like a personality bio describing who they generally are ("you tend to be the kind of person who..."). Ground everything in their actual rasi, nakshatra, and element — but translate it into plain, everyday English a complete beginner would understand instantly. Never print a bare astrology word on its own: no "rasi," "nakshatra," "sign," "zodiac," or a standalone element name like "Fire," "Earth," "Air," or "Water." An element can only appear fused into a descriptive phrase, exactly like a real horoscope would phrase it — e.g. "today's airy energy," "your fiery drive today," "those grounded, Earth-steady friends." Nothing about this reader's profession or role is known, so the work field must stay broadly applicable to anyone with a job or daily responsibilities — never guess or imply a specific profession.

Never use an em dash (—) or en dash (–) anywhere in the output. Use a comma, a period, or "and"/"but" instead.

Respond with ONLY a JSON object, no markdown, no commentary, in exactly this shape:
{
  "hook": "One short, blunt, punchy line about today specifically — reads like a philosophical text message from a brutally honest friend. Declarative or imperative, not a question.",
  "coreEnergy": "1-2 sentences on today's energy for this chart, written like a daily horoscope — how today will actually feel emotionally, not a general description of their personality.",
  "workProductivity": "1-2 sentences, a quick practical nudge about work or daily responsibilities today specifically. Broadly applicable to anyone with a job, not tied to any specific profession.",
  "loveRelationships": "1-2 sentences on love/dating/relationship energy for today. Be specific and a little cheeky, not generic.",
  "socialDynamics": "1-2 sentences about who they'll click or clash with today, in friendships or family. Describe those people by personality/behavior only, fused with a flavor word if it helps, e.g. 'your chatty, free-spirited friends' or 'those clingy, emotional types' — never a bare element name or astrology label on its own.",
  "dos": ["2-3 short imperative phrases, each under 6 words, things to do today"],
  "donts": ["2-3 short imperative phrases, each under 6 words, things to avoid today"],
  "quote": "One original, short aphorism in the same voice. NOT a real quote from any real person, book, song, or media — write it fresh, as if it's wisdom you just came up with on the spot."
}

Keep every field short and scannable. No disclaimers, no mentioning you're an AI, no astrology jargon-dumps.`;

export interface PreviewContent {
  hook: string;
  coreEnergy: string;
  workProductivity: string;
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

// Defensive net on top of the prompt instruction — models slip back into
// em dashes often enough that relying on the instruction alone isn't safe.
function stripDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ', ');
}

function sanitizeContent(content: PreviewContent): PreviewContent {
  return {
    hook: stripDashes(content.hook),
    coreEnergy: stripDashes(content.coreEnergy),
    workProductivity: stripDashes(content.workProductivity),
    loveRelationships: stripDashes(content.loveRelationships),
    socialDynamics: stripDashes(content.socialDynamics),
    dos: content.dos.map(stripDashes),
    donts: content.donts.map(stripDashes),
    quote: stripDashes(content.quote),
  };
}

function assertPreviewContent(value: unknown): PreviewContent {
  const v = value as Partial<PreviewContent> | null;
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
  return v as PreviewContent;
}

export async function generatePreviewContent(input: PreviewContentInput, apiKey: string): Promise<PreviewContent> {
  const element = RASI_ELEMENTS[input.rasi] ?? 'Unknown';

  const userPrompt = `Rasi: ${input.rasi} (${element} sign)
Nakshatra: ${input.nakshatra} (pada ${input.pada})

Write today's vibe snapshot for this chart as JSON.`;

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

  return sanitizeContent(assertPreviewContent(parsed));
}
