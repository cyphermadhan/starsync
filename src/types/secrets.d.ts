// Hand-declared secret names for TypeScript only — merges into the
// Cloudflare.Env interface that worker-configuration.d.ts generates from
// wrangler.toml. These are never declared in wrangler.toml itself: doing
// that (as [vars]) and deploying actively overwrites a same-named Secret
// with the plain-text var value. Secrets must only ever be set out-of-band
// via `wrangler secret put <NAME> --name starsync`. This file exists so
// `astro check` passes in CI (which has no .dev.vars to infer names from)
// without ever touching runtime bindings.
declare namespace Cloudflare {
  interface Env {
    ENCRYPTION_KEY: string;
    RAZORPAY_KEY_ID: string;
    RAZORPAY_KEY_SECRET: string;
    RAZORPAY_WEBHOOK_SECRET: string;
    RAZORPAY_PLAN_ID: string;
    OPENAI_API_KEY: string;
  }
}
