export interface ContactMessage {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactMailConfig {
  apiKey: string;
  fromEmail: string;
  toEmail: string;
  fromName?: string;
}

export interface ContactMailResult {
  ok: boolean;
  status: number;
  providerMessage?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function getContactMailConfig(env: Record<string, string | undefined>): ContactMailConfig | null {
  const apiKey = env['RESEND_API_KEY']?.trim();
  const fromEmail = env['CONTACT_FROM_EMAIL']?.trim();
  const toEmail = env['CONTACT_TO_EMAIL']?.trim();

  if (!apiKey || !fromEmail || !toEmail) {
    return null;
  }

  return {
    apiKey,
    fromEmail,
    toEmail,
    fromName: env['CONTACT_FROM_NAME']?.trim() || 'SafePDFHub Contact'
  };
}

export async function sendContactMessage(
  message: ContactMessage,
  config: ContactMailConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ContactMailResult> {
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [config.toEmail],
      reply_to: message.email,
      subject: `[SafePDFHub Contact] ${message.subject}`,
      text: [
        `Name: ${message.name}`,
        `Email: ${message.email}`,
        `Subject: ${message.subject}`,
        '',
        message.message
      ].join('\n'),
      html: buildHtml(message)
    }),
    signal: AbortSignal.timeout(10_000)
  });

  const providerBody = await response.json().catch(() => null) as {
    message?: string;
    name?: string;
  } | null;

  return {
    ok: response.ok,
    status: response.status,
    providerMessage: providerBody?.message || providerBody?.name
  };
}

function buildHtml(message: ContactMessage): string {
  return [
    '<!doctype html>',
    '<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#17202a">',
    '<h2>SafePDFHub contact message</h2>',
    `<p><strong>Name:</strong> ${escapeHtml(message.name)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(message.email)}</p>`,
    `<p><strong>Subject:</strong> ${escapeHtml(message.subject)}</p>`,
    '<hr>',
    `<p>${escapeHtml(message.message).replaceAll('\n', '<br>')}</p>`,
    '</body></html>'
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
