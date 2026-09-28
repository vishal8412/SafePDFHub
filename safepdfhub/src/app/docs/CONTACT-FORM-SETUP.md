# SafePDFHub Contact Form Setup

The production Contact page uses a first-party `POST /api/contact` endpoint. The browser sends the form to SafePDFHub; the SSR server validates the request and forwards it to the configured support mailbox through the Resend Email API.

## Required runtime environment variables

```text
RESEND_API_KEY=re_xxxxxxxxx
CONTACT_FROM_EMAIL=hello@safepdfhub.com
CONTACT_TO_EMAIL=hello@safepdfhub.com
CONTACT_FROM_NAME=SafePDFHub Contact
TRUST_PROXY=true
```

`TRUST_PROXY=true` should only be enabled when the Node SSR server is behind a trusted reverse proxy/load balancer.

## Resend setup

1. Create a Resend account and verify the SafePDFHub sending domain.
2. Create a send-only API key and restrict it to the verified sending domain when the Resend account allows domain-scoped permissions.
3. Set `CONTACT_FROM_EMAIL` to a verified address on that domain.
4. Set `CONTACT_TO_EMAIL` to the mailbox that should receive support/contact submissions.
5. Store `RESEND_API_KEY` only as a server-side runtime secret. Never add it to Angular environment files or browser JavaScript.

## Security behavior

- Request body is limited to 20 KB.
- Name, email, subject, and message are length-validated.
- Subject/name/email line breaks are normalized to prevent header-style injection.
- A hidden honeypot field is used for basic bot filtering.
- Submissions made too quickly are rejected.
- A lightweight in-process rate limiter allows at most five submissions per IP per hour.
- Submitted message contents are not written to application logs.
- Contact messages are not stored in the PDF processing system.
- The direct email address remains available as a fallback.

## Production privacy notice

Because the form uses a transactional email provider, the production Privacy Policy should identify that provider and describe its role as a processor of contact information. The current Privacy page has been updated to describe the server-backed Contact flow; review the final wording against the exact provider/account configuration before launch.

## Local development

There are two different local modes:

### 1. UI development with `ng serve`

The project `start` script uses Angular's development server. Angular's dev server does **not** execute the custom `src/server.ts` Express application, so the first-party `POST /api/contact` route is not available in this mode. The Contact form now detects this condition instead of leaving the button in an endless loading state.

Use `ng serve` for UI work, but do not use it as the end-to-end email delivery test.

### 2. End-to-end Contact testing

Create a real `.env` file from `.env.example` and set the server-only variables. Then build and run the SSR/Express server:

```bash
copy .env.example .env
npm install
npm run build
npm run serve:ssr:safepdfhub
```

Open the Contact page through the SSR server (normally `http://localhost:4000/contact`) and submit a valid message. The SSR server loads the local `.env` file and exposes `POST /api/contact`.

If the Resend configuration is missing, the API returns HTTP 503. If Resend rejects the message, the server logs the provider status/message while the browser receives a safe generic error. The UI also has a 15-second client timeout so it cannot remain on `Sending...` indefinitely.

For production, configure the environment variables in the hosting platform rather than committing `.env`.
