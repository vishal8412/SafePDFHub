import { describe, expect, it } from 'vitest';
import { getContactMailConfig, sendContactMessage } from './contact-mail';

describe('contact mail delivery', () => {
  it('requires the production mail configuration', () => {
    expect(getContactMailConfig({})).toBeNull();
    expect(getContactMailConfig({
      RESEND_API_KEY: 're_test',
      CONTACT_FROM_EMAIL: 'hello@safepdfhub.com',
      CONTACT_TO_EMAIL: 'hello@safepdfhub.com'
    })).toEqual({
      apiKey: 're_test',
      fromEmail: 'hello@safepdfhub.com',
      toEmail: 'hello@safepdfhub.com',
      fromName: 'SafePDFHub Contact'
    });
  });

  it('builds a safe email payload and sends it through the configured provider', async () => {
    let request: RequestInit | undefined;

    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      request = init;
      return new Response(null, { status: 200 });
    };

    const result = await sendContactMessage(
      {
        name: 'Vishal',
        email: 'vishal@example.com',
        subject: 'PDF help',
        message: 'Please help me with this PDF issue.'
      },
      {
        apiKey: 're_test',
        fromEmail: 'hello@safepdfhub.com',
        toEmail: 'hello@safepdfhub.com',
        fromName: 'SafePDFHub Contact'
      },
      fetchMock
    );

    expect(result).toEqual({ ok: true, status: 200 });
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Authorization: 'Bearer re_test',
      'Content-Type': 'application/json',
      Accept: 'application/json'
    });

    const payload = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(payload['reply_to']).toBe('vishal@example.com');
    expect(payload['to']).toEqual(['hello@safepdfhub.com']);
    expect(payload['subject']).toBe('[SafePDFHub Contact] PDF help');
  });
});
