# Future - Scale Roadmap (100 to 1M)

Pending only. Implemented items removed.

## Recommendations 1-7 (research verdict)

1. **Cooldown KV → Rate Limiter/DO:** DO NOT do now. Rate Limiter is burst + per-edge approximate, not 1s/3s cooldown (needs 20/min vs 60/min second binding, burst semantics differ). DO per-user = 1M DOs same writes as KV. Keep KV (50k ops/day at 10k DAU < Paid 10M). Review if KV >$50/mo.
2. **Usage D1 → Queue:** DO NOT do now. Async delays quota reads by seconds → cap overrun (requires `requestId` idempotency + reconciliation). Keep sync D1 batch until 100k. At 100k shard usage by `userId` prefix or `user_monthly_usage` month+user region; add queue only for analytics.
3. **Provider health KV → DO:** DO NOT do now. `health.ts` is memoed 15s, writes only on trip (3 failures → 30s). KV ops few/min. DO migration adds no gain.
4. **Global rate bucket DO:** DO NOT do now. Funnels all traffic through sharded DOs (warned in Cloudflare docs/Reddit). Keep per-edge 500/min until abuse observed in sampled logs.

## Infrastructure backlog

- [ ] **10k DAU:** `wrangler deploy --env paid`, D1 Paid, KV Paid, verify Brevo domain (`noreply@ekwe.app`), flip `REQUIRE_APP_CHECK`. Cost ~$10/mo.
- [ ] **100k DAU:** D1 read replica / Hyperdrive, move usage counters off D1, cap Analytics writes, Durable Object stream concurrency plan (add Deepgram keys past 200), R2 lifecycle 1-7 day TTL + purge.
- [ ] **1M DAU:** Shard D1 by region, per-user counters in DO/Analytics, Payments webhook sharding, Cloudflare Workers Paid (10M incl.), 500+ Deepgram keys for streams or drop live dictation cap.

## Billing notes

- Collect `$2.23/mo` (`$21.41/yr` = $1.78/mo). Flutterwave net ~$2.12 NG / ~$2.02 intl.
- Realistic 5% conversion @ 10% quota use: $0 until 10k, ~$2.5-3k/mo at 100k, ~$40-60k/mo at 1M (profit $8k / $50k). Needs ≥2.3% conversion at 1M to break even.
- Pay only: **Deepgram** (3 accts) + **Cloudflare** (1 acct Workers Paid). Keep Gemini/Groq/AssemblyAI free forever; ElevenLabs only fallback (1 key, $0.05/1k chars). Mistral is Experiment free — do NOT budget as guaranteed monthly; rely on Groq/Gemini for volume.
- AssemblyAI free tier confirmed **$50 one-time credits**, _not_ 185h/mo recurring. Blogs quoting 185h/333h are credit equivalents.
