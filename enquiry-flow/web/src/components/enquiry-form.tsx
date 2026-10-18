'use client';

import { useEffect, useState } from 'react';

import { PACKAGE_NAMES, PRICING_MODEL_NAMES, readDemoHandoff } from '@/lib/demo-handoff';
import { API_BASE_URL, API_STATIC_TOKEN, ENQUIRY_HONEYPOT_FIELD, SITE } from '@/lib/site';

/**
 * The enquiry form — Book a Demo and Contact.
 *
 * THE ONLY INTERACTIVE THING ON THIS SITE, and the reason it exists at all.
 * Everything else is a static page a crawler reads; this is the conversion
 * path. The approval pack drew both forms as styled <div>s and <span>s — a
 * picture of a form — so the ported pages had no inputs, no submit and no way
 * for a visitor to make contact.
 *
 * ── WHY THE ERROR PATH IS AS LONG AS THE SUCCESS PATH ─────────────────────
 *
 * A lost enquiry is invisible: the visitor believes they got in touch and
 * nobody knows they exist. So every failure ends with the email address in
 * front of them rather than a red box saying "something went wrong". If our
 * API is down, mailto: still works.
 *
 * ── THE HONEYPOT ──────────────────────────────────────────────────────────
 *
 * A real input, positioned off-screen, `tabIndex={-1}`, `autoComplete="off"`
 * and `aria-hidden`. Not `display: none`: some bots skip hidden fields, and
 * some screen readers announce them — this way it is invisible to people and
 * to assistive tech while still looking fillable to a script. The server
 * answers a filled honeypot with a normal success, so a bot learns nothing.
 *
 * ── PACKAGE, "HOW WOULD YOU LIKE TO PAY?", AND THE PRICING HANDOFF ────────
 *
 * /pricing sends visitors here with their selection in the URL — a package
 * card's "Book a Demo" (package, model, starting price) or the calculator's
 * "Book a demo with this setup" (everything it knows). lib/demo-handoff.ts
 * owns the parameter names on both ends. This form reads them in a
 * `useEffect` off `window.location.search` (not `next/navigation`'s
 * `useSearchParams`, which needs a server to have parsed the URL before
 * render — this is a static export) and:
 *
 *   - pre-selects the Package and "How would you like to pay?" fields,
 *   - prefills the message box with the rest of the configuration, where the
 *     visitor can see and edit exactly what will be sent.
 *
 * EnquiryController keeps only the fields it validates and silently drops
 * the rest, so `package` and `pricing_model` would never reach the CRM as
 * fields. On submit they are folded into the top of `message` instead,
 * which lands on the lead's `requirements` — the first thing a salesperson
 * reads. Every select and the message box are controlled so the effect can
 * set them after mount.
 */

type Field = {
  readonly name: string;
  readonly label: string;
  readonly type?: 'text' | 'email' | 'tel' | 'textarea' | 'select';
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly placeholder?: string;
  readonly full?: boolean;
};

const FIELDS: readonly Field[] = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'email', label: 'Work email', type: 'email', required: true },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'business_name', label: 'Business name' },
  {
    name: 'business_type',
    label: 'Business type',
    type: 'select',
    /*
     * The seven sectors the product is sold into, and they are not decoration:
     * whatever is picked here is written onto the CRM lead's requirements, so
     * this list is what the sales team sorts the pipeline by. Keep it in step
     * with SECTORS in lib/site.ts.
     *
     * Clinics are here now because they are real business types in the backend
     * — a clinic that signs up onboards as an appointment business rather than
     * falling through to the restaurant profile. Grocery stays absent: weighed
     * items and PLU lookup are not built, and offering it here would collect
     * leads the product cannot serve.
     */
    options: [
      'Salon or spa',
      'Wellness centre',
      'Aesthetic clinic',
      'Dental clinic',
      'Other appointment business',
      'Retail',
      'Restaurant or café',
      'Other',
    ],
    full: true,
  },
  // Both option lists come from lib/demo-handoff.ts — the same names /pricing
  // puts in the URL — so a pre-selected value always matches an option.
  {
    name: 'package',
    label: 'Package',
    type: 'select',
    options: [...PACKAGE_NAMES, 'Not sure yet'],
  },
  {
    name: 'pricing_model',
    label: 'How would you like to pay?',
    type: 'select',
    options: [...PRICING_MODEL_NAMES, 'Not sure yet'],
  },
  {
    name: 'message',
    label: 'What would you like to see?',
    type: 'textarea',
    placeholder: 'Tell us how you trade today — your services, branches, busiest hour.',
    full: true,
  },
];

type Status = 'idle' | 'sending' | 'sent' | 'error';

/**
 * How long to wait for the API before giving up. Without a limit a hung
 * connection leaves the button on "Sending…" forever and the visitor never
 * reaches the email fallback. Generous enough for a slow mobile network.
 */
export const SUBMIT_TIMEOUT_MS = 15_000;

/**
 * A correlation id sent as X-Request-ID. The server adds it to every log line
 * for the request, so a visitor's "it failed around two o'clock" can be traced
 * to one request in the logs or in New Relic.
 */
function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function EnquiryForm({ page, submitLabel = 'Book a Demo' }: { page: string; submitLabel?: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectValues, setSelectValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  // Pick up a selection carried over from /pricing (see the docblock). Only
  // recognised names are applied — an unknown or missing param leaves the
  // field on "Select…", same as a visitor who arrived any other way. The
  // currency is read from the same `data-cur` attribute the site's CSS
  // toggle uses, after mount, so there is nothing to mismatch on hydration.
  useEffect(() => {
    const currency = document.documentElement.getAttribute('data-cur') === 'usd' ? 'usd' : 'pkr';
    const handoff = readDemoHandoff(window.location.search, currency);

    setSelectValues((prev) => ({
      ...prev,
      ...(handoff.packageName ? { package: handoff.packageName } : {}),
      ...(handoff.pricingModel ? { pricing_model: handoff.pricingModel } : {}),
    }));

    if (handoff.summary.length > 0) {
      setMessage(`My setup, from the pricing page:\n${handoff.summary.join('\n')}\n\n`);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    setErrors({});

    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = { page };
    form.forEach((value, key) => {
      payload[key] = String(value);
    });

    // The backend keeps only the fields it validates, and these two are not
    // among them — fold them into the top of the message so they reach the
    // CRM lead rather than being silently dropped.
    const choices = [
      payload.package ? `Package: ${payload.package}` : null,
      payload.pricing_model ? `How they would like to pay: ${payload.pricing_model}` : null,
    ].filter((line): line is string => line !== null);

    if (choices.length > 0) {
      payload.message = [choices.join('\n'), payload.message?.trim()].filter(Boolean).join('\n\n');
    }

    delete payload.package;
    delete payload.pricing_model;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/imflow360/marketing/enquiries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-TOKEN': API_STATIC_TOKEN,
          'X-Request-ID': newRequestId(),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 422) {
        // Field-level messages from Laravel's validator, shown against the
        // field rather than as one lump at the top.
        const body = await response.json();
        const flat: Record<string, string> = {};
        for (const [field, messages] of Object.entries(body.errors ?? {})) {
          flat[field] = Array.isArray(messages) ? String(messages[0]) : String(messages);
        }
        setErrors(flat);
        setStatus('idle');

        return;
      }

      setStatus(response.ok ? 'sent' : 'error');
    } catch {
      // Network failure, CORS, DNS, offline, or our own timeout.
      // Indistinguishable from here and the visitor does not care which —
      // they get the same fallback.
      setStatus('error');
    } finally {
      clearTimeout(timer);
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="status"
        className="rounded-[12px] border border-[#12A5A0] bg-[#E6F7F6] p-6 text-[#0E2A47]"
      >
        <p style={{ fontFamily: 'var(--font-display)' }} className="text-[17px] font-extrabold">
          Thank you — we have your enquiry.
        </p>
        <p className="mt-2 text-[13.5px] leading-[1.62] text-[#5B7186]">
          Someone will be in touch shortly. If it is urgent, email us at{' '}
          <a href={`mailto:${SITE.email}`} className="font-semibold text-[#12A5A0]">
            {SITE.email}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.name} className={field.full ? 'sm:col-span-2' : undefined}>
            <label
              htmlFor={`enquiry-${field.name}`}
              className="mb-1.5 block text-[12.5px] font-semibold text-[#0E2A47]"
            >
              {field.label}
              {field.required ? <span className="text-[#12A5A0]"> *</span> : null}
            </label>

            {field.type === 'textarea' ? (
              <textarea
                id={`enquiry-${field.name}`}
                name={field.name}
                rows={message ? 8 : 4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                // The backend caps message at 4,000 characters, and the
                // package/payment lines are added on submit — leave room.
                maxLength={3800}
                placeholder={field.placeholder}
                required={field.required}
                aria-invalid={Boolean(errors[field.name])}
                className="w-full rounded-[8px] border border-[#E3E9EF] px-3 py-2.5 text-[14px] text-[#0E2A47] outline-none focus:border-[#12A5A0]"
              />
            ) : field.type === 'select' ? (
              <select
                id={`enquiry-${field.name}`}
                name={field.name}
                value={selectValues[field.name] ?? ''}
                onChange={(e) => setSelectValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                className="w-full rounded-[8px] border border-[#E3E9EF] bg-white px-3 py-2.5 text-[14px] text-[#0E2A47] outline-none focus:border-[#12A5A0]"
              >
                <option value="">Select…</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`enquiry-${field.name}`}
                name={field.name}
                type={field.type ?? 'text'}
                placeholder={field.placeholder}
                required={field.required}
                aria-invalid={Boolean(errors[field.name])}
                className="w-full rounded-[8px] border border-[#E3E9EF] px-3 py-2.5 text-[14px] text-[#0E2A47] outline-none focus:border-[#12A5A0]"
              />
            )}

            {errors[field.name] ? (
              <p className="mt-1 text-[12px] text-[#EF4444]">{errors[field.name]}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/*
        The honeypot. Off-screen rather than display:none, excluded from the
        tab order, and hidden from assistive tech — invisible to people,
        fillable by a script.
      */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`enquiry-${ENQUIRY_HONEYPOT_FIELD}`}>Company website</label>
        <input
          id={`enquiry-${ENQUIRY_HONEYPOT_FIELD}`}
          name={ENQUIRY_HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="inline-flex h-12 items-center justify-center rounded-[8px] bg-[#12A5A0] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#0E807C] disabled:opacity-60"
        >
          {status === 'sending' ? 'Sending…' : submitLabel}
        </button>

        <p className="text-[12.5px] text-[#93A3B4]">
          We use your details to reply to this enquiry. Nothing else.
        </p>
      </div>

      {status === 'error' ? (
        <div role="alert" className="rounded-[8px] border border-[#EF4444] bg-red-50 p-4">
          <p className="text-[13.5px] text-[#0E2A47]">
            We could not send that just now. Please email{' '}
            <a href={`mailto:${SITE.email}`} className="font-semibold text-[#12A5A0]">
              {SITE.email}
            </a>{' '}
            and we will pick it up straight away.
          </p>
        </div>
      ) : null}
    </form>
  );
}
