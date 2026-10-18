import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENQUIRY_HONEYPOT_FIELD, SITE } from '@/lib/site';

import { EnquiryForm, SUBMIT_TIMEOUT_MS } from './enquiry-form';

/**
 * The enquiry form is the site's only conversion path, and a lost enquiry is
 * invisible. These tests defend the three things that make it trustworthy:
 * what is SENT (the folded payload and its headers), what the visitor SEES for
 * each outcome, and that no failure ever leaves them without the email address.
 */

type FetchMock = ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>): FetchMock {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);

  return fn;
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), 'Ayesha Khan');
  await user.type(screen.getByLabelText(/work email/i), 'ayesha@glowsalon.test');
}

function sentBody(fetchMock: FetchMock): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

  return JSON.parse(String(init.body));
}

beforeEach(() => {
  window.history.pushState({}, '', '/book-demo/');
  document.documentElement.removeAttribute('data-cur');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EnquiryForm — pricing handoff', () => {
  it('pre-selects the package and payment model and prefills the message from the URL', async () => {
    window.history.pushState(
      {},
      '',
      '/book-demo/?package=Growth&model=Monthly&branches=3&price_pkr=PKR+9,000',
    );

    render(<EnquiryForm page="Book a demo" />);

    await waitFor(() => expect(screen.getByLabelText(/^package/i)).toHaveValue('Growth'));
    expect(screen.getByLabelText(/how would you like to pay/i)).toHaveValue('Monthly');
    expect(
      (screen.getByLabelText(/what would you like to see/i) as HTMLTextAreaElement).value,
    ).toContain('Branches: 3');
  });

  it('leaves the selects on "Select…" when the URL carries nothing recognised', () => {
    window.history.pushState({}, '', '/book-demo/?package=Enterprise');

    render(<EnquiryForm page="Book a demo" />);

    expect(screen.getByLabelText(/^package/i)).toHaveValue('');
  });
});

describe('EnquiryForm — what is sent', () => {
  it('posts JSON with the token, a request id and the page, and folds package and model into the message', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(async () => respond(200, { status: true }));
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/^package/i), 'Premium');
    await user.selectOptions(screen.getByLabelText(/how would you like to pay/i), 'Flexible');
    await user.type(screen.getByLabelText(/what would you like to see/i), '  Two branches  ');
    await user.click(screen.getByRole('button', { name: /book a demo/i }));

    await screen.findByRole('status');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/imflow360\/marketing\/enquiries$/);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect((init.headers as Record<string, string>)['X-Request-ID']).toMatch(/\S{8,}/);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = sentBody(fetchMock);
    expect(body).toMatchObject({
      page: 'Contact',
      name: 'Ayesha Khan',
      email: 'ayesha@glowsalon.test',
    });
    expect(body.message).toBe(
      'Package: Premium\nHow they would like to pay: Flexible\n\nTwo branches',
    );
    // The backend would drop these silently; they must not travel as fields.
    expect(body).not.toHaveProperty('package');
    expect(body).not.toHaveProperty('pricing_model');
  });

  it('sends a different request id for each submission', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(async () => respond(500));
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /book a demo/i }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /book a demo/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const ids = fetchMock.mock.calls.map(
      (call) =>
        (call[1] as RequestInit & { headers: Record<string, string> }).headers['X-Request-ID'],
    );
    expect(new Set(ids).size).toBe(2);
  });
});

describe('EnquiryForm — honeypot', () => {
  it('is invisible to people and assistive tech but present for a script', () => {
    render(<EnquiryForm page="Contact" />);

    const trap = document.getElementById(`enquiry-${ENQUIRY_HONEYPOT_FIELD}`) as HTMLInputElement;

    expect(trap).toBeInTheDocument();
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('is submitted with the form so the server can catch a bot that fills it', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(async () => respond(200));
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    fireEvent.change(
      document.getElementById(`enquiry-${ENQUIRY_HONEYPOT_FIELD}`) as HTMLInputElement,
      {
        target: { value: 'http://bot-link.invalid' },
      },
    );
    await user.click(screen.getByRole('button', { name: /book a demo/i }));
    await screen.findByRole('status');

    expect(sentBody(fetchMock)[ENQUIRY_HONEYPOT_FIELD]).toBe('http://bot-link.invalid');
  });
});

describe('EnquiryForm — outcomes the visitor sees', () => {
  it('shows a thank-you with the email fallback on success', async () => {
    const user = userEvent.setup();
    mockFetch(async () => respond(200, { status: true }));
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /book a demo/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/thank you/i);
    expect(screen.getByRole('link', { name: SITE.email })).toHaveAttribute(
      'href',
      `mailto:${SITE.email}`,
    );
  });

  it('maps a 422 to messages beside the fields and keeps the form editable', async () => {
    const user = userEvent.setup();
    mockFetch(async () =>
      respond(422, {
        errors: {
          email: ['The email field must be a valid email address.'],
          name: ['The name field is required.'],
        },
      }),
    );
    render(<EnquiryForm page="Contact" />);

    await user.click(screen.getByRole('button', { name: /book a demo/i }));

    expect(
      await screen.findByText('The email field must be a valid email address.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The name field is required.')).toBeInTheDocument();
    expect(screen.getByLabelText(/work email/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /book a demo/i })).toBeEnabled();
  });

  it.each([[500], [503], [429], [403]])('shows the email fallback for HTTP %i', async (status) => {
    const user = userEvent.setup();
    mockFetch(async () => respond(status));
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /book a demo/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SITE.email);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the email fallback when the network fails', async () => {
    const user = userEvent.setup();
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /book a demo/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(SITE.email);
  });

  it('disables the button while sending so a double click cannot submit twice', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    const fetchMock = mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    render(<EnquiryForm page="Contact" />);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /book a demo/i }));

    const sending = await screen.findByRole('button', { name: /sending/i });
    expect(sending).toBeDisabled();
    await user.click(sending);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => release(respond(200)));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});

describe('EnquiryForm — timeout', () => {
  it('aborts a hung request after the timeout and shows the email fallback', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    render(<EnquiryForm page="Contact" />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Ayesha Khan' } });
    fireEvent.submit(
      screen.getByRole('button', { name: /book a demo/i }).closest('form') as HTMLFormElement,
    );
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS - 1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(SITE.email);
    expect(screen.getByRole('button', { name: /book a demo/i })).toBeEnabled();
  });
});
