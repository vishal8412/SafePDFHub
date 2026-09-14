# SafePDFHub — About, Contact & Legal Pages

Implemented on 2026-09-14 from the provided `src(4).zip`.

## Routes
- `/about` — product mission, principles and CTA
- `/contact` — contact categories and client-side mailto form
- `/privacy` — privacy policy draft aligned with the current local-first/browser-processing architecture
- `/terms` — terms of service draft
- `/support` — existing Support page remains unchanged

## Important production configuration
The Contact page currently uses `hello@safepdfhub.com` as the public mailbox placeholder. Replace `contactEmail` in:
`src/app/features/pages/contact/contact.component.ts`
if the production mailbox is different.

The Privacy Policy and Terms are deliberately written as product-ready drafts rather than pretending to be jurisdiction-specific legal advice. Before commercial launch, confirm:
- legal operator/business name and notice address
- final hosting/CDN, analytics, advertising and cookie behavior
- payment provider and refund/cancellation terms
- applicable governing law and jurisdiction
- any third-party processors or integrations

No backend contact API was invented. The Contact form opens the visitor's email application, so the website itself does not receive the form fields.
