# SafePDFHub — About, Contact & Legal Pages

Implemented on 2026-09-14 from the provided `src(4).zip`.

## Routes
- `/about` — product mission, principles and CTA
- `/contact` — contact categories and first-party server-backed contact form
- `/privacy` — privacy policy draft aligned with the current local-first/browser-processing architecture
- `/terms` — terms of service draft
- `/support` — existing Support page remains unchanged

## Important production configuration
The Contact page currently uses `hello@safepdfhub.com` as the public mailbox placeholder. Replace `contactEmail` in:
`src/app/config/site.config.ts` if the production mailbox differs.
if the production mailbox is different.

The Privacy Policy and Terms are deliberately written as product-ready drafts rather than pretending to be jurisdiction-specific legal advice. Before commercial launch, confirm:
- legal operator/business name and notice address
- final hosting/CDN, analytics, advertising and cookie behavior
- payment provider and refund/cancellation terms
- applicable governing law and jurisdiction
- any third-party processors or integrations

The Contact page now submits to the first-party `/api/contact` endpoint. The endpoint validates and rate-limits requests, rejects the hidden honeypot field, and forwards the message through the configured transactional email provider. Contact messages are not persisted by the SafePDFHub PDF-processing system. A direct `mailto:` fallback remains available for visitors who prefer their email app.

## Contact form production configuration

The server-backed form uses the Resend Email API from the server only. The API key must never be exposed to Angular/browser code. Configure these runtime environment variables on the SSR server:

- `RESEND_API_KEY` — a send-only Resend API key restricted to the verified sending domain.
- `CONTACT_FROM_EMAIL` — a verified sender address on the SafePDFHub sending domain.
- `CONTACT_TO_EMAIL` — the mailbox that should receive Contact submissions.
- `CONTACT_FROM_NAME` — optional sender display name; defaults to `SafePDFHub Contact`.
- `TRUST_PROXY=true` — set only when the SSR server is behind a trusted reverse proxy/load balancer so the rate limiter can use `X-Forwarded-For`.

The endpoint applies a five-submissions-per-IP-per-hour in-process limit, validates name/email/subject/message lengths, uses a honeypot field, and rejects submissions that arrive too quickly. It does not log submitted message contents.
