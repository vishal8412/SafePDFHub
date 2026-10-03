import { describe, expect, it } from 'vitest';
import { createContactResponse } from './contact-request';

describe('shared contact request validation', () => {
  const valid = { name: 'A. User', email: 'user@example.com', subject: 'Help', message: 'Please help me with this issue.', startedAt: 1 };
  it('rejects invalid input without contacting the mail provider', async () => {
    const response = await createContactResponse({ ...valid, email: 'bad' }, {}, 'invalid-case', 2_000);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Please enter a valid email address.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('honors the honeypot without requiring mail credentials', async () => {
    const response = await createContactResponse({ website: 'spam' }, {}, 'honeypot-case', 2_000);
    expect(response.status).toBe(200);
  });
  it('requires the minimum form dwell time', async () => {
    const response = await createContactResponse(valid, {}, 'fast-submit-case', 1_100);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Please take a moment to complete the form and try again.' });
  });
});
