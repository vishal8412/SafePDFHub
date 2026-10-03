import { getContactMailConfig, sendContactMessage } from './contact-mail';

const CONTACT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX = 5;
const contactRateLimit = new Map<string, number[]>();

/** Shared validation and delivery path for the Node server and Netlify SSR. */
export async function createContactResponse(
  bodyValue: unknown,
  env: Record<string, string | undefined>,
  rateLimitKey: string,
  now = Date.now()
): Promise<Response> {
  const body = isRecord(bodyValue) ? bodyValue : {};
  const name = cleanSingleLine(body['name']);
  const email = cleanSingleLine(body['email']);
  const subject = cleanSingleLine(body['subject']);
  const message = cleanMessage(body['message']);
  const website = cleanSingleLine(body['website']);
  const startedAt = Number(body['startedAt']);
  const json = (status: number, message: string) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });

  if (website) return json(200, 'Your message has been sent. Thank you for contacting SafePDFHub.');
  if (!name || name.length > 100) return json(400, 'Please enter your name.');
  if (!isValidEmail(email)) return json(400, 'Please enter a valid email address.');
  if (!subject || subject.length > 160) return json(400, 'Please enter a valid subject.');
  if (message.length < 10 || message.length > 5000) return json(400, 'Please provide a little more detail in your message.');
  if (!Number.isFinite(startedAt) || now - startedAt < 1200) return json(400, 'Please take a moment to complete the form and try again.');
  if (!allowContactRequest(rateLimitKey, now)) return json(429, 'Too many messages from this connection. Please try again later.');

  const config = getContactMailConfig(env);
  if (!config) return json(503, 'Contact email is temporarily unavailable. Please email us directly instead.');
  try {
    const result = await sendContactMessage({ name, email, subject, message }, config);
    if (!result.ok) {
      console.error('Contact email provider rejected the message.', { status: result.status, providerMessage: result.providerMessage });
      return json(502, 'We could not send your message right now. Please try again or email us directly.');
    }
    return json(200, 'Your message has been sent. Thank you for contacting SafePDFHub.');
  } catch (error) {
    console.error('Contact email delivery failed.', error);
    return json(502, 'We could not send your message right now. Please try again or email us directly.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function cleanSingleLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : '';
}
function cleanMessage(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() : '';
}
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
function allowContactRequest(key: string, now: number): boolean {
  const recent = (contactRateLimit.get(key) || []).filter(timestamp => now - timestamp < CONTACT_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= CONTACT_RATE_LIMIT_MAX) {
    contactRateLimit.set(key, recent);
    return false;
  }
  recent.push(now);
  contactRateLimit.set(key, recent);
  if (contactRateLimit.size > 1000) {
    for (const [rateKey, timestamps] of contactRateLimit) {
      if (timestamps.every(timestamp => now - timestamp >= CONTACT_RATE_LIMIT_WINDOW_MS)) contactRateLimit.delete(rateKey);
    }
  }
  return true;
}
