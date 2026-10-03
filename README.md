# StarSync

Vedic astrology daily-email subscription product, built on Astro + Cloudflare Workers/D1/Queues.

## Architecture

### Instant free preview reading flow

Anyone can try a reading on the site itself, no email required, before subscribing to the daily
email. Rate-limited per IP (3 free tries/day) and cached permanently per rasi + nakshatra + pada
combo, so each chart combo is only ever generated once.

![Instant free preview reading flow](docs/preview-reading-flow.png)
