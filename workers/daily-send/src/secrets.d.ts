// Hand-declared secret names for TypeScript only — same pattern as the main
// project's src/types/secrets.d.ts, and for the same reason: these must
// never be declared in wrangler.toml's [vars], which actively overwrites a
// same-named Secret with a plain-text value on deploy. Set these via
// `wrangler secret put <NAME> --name starsync-daily-send` only.
interface Env {
  ENCRYPTION_KEY: string;
  OPENAI_API_KEY: string;
  RESEND_API_KEY: string;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_PLAN_ID: string;
}
