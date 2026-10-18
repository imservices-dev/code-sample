# Enquiry flow — API, React form and tests

A complete vertical slice of one feature: the public "Book a demo / Contact" form
of a marketing site. It is the only place on that platform where an anonymous
visitor creates records, so it is built defensively.

```
enquiry-flow/
  api/   Laravel 11: route, controller, service, config, PHPUnit feature tests
  web/   React + TypeScript form, with Vitest + Testing Library tests (runnable on its own)
```

This is extracted from a production codebase. The React side runs standalone. The
API side is **excerpted, not standalone**: it depends on the host application's
CRM models, services and middleware, which are not included. The API tests were
run in the full application (22 passing, 78 assertions) and cannot run from this
folder alone.

## Run the React part

```bash
cd web
npm install
npm test            # 23 tests
npm run type-check
```

## What happens when a visitor submits

1. The form validates nothing itself beyond `required` hints; it posts JSON with a
   static site token, an `X-Request-ID`, and a 15-second timeout.
2. The API checks the token, then that the token belongs to the site allowed to
   post enquiries, then the per-IP rate limit, then validates the fields.
3. A filled honeypot field gets the **same success response** as a real enquiry
   and writes nothing, so a bot learns nothing.
4. The service writes Company → Contact → Lead in **one transaction**, and
   independently sends a notification. If the CRM write fails, the notification
   still goes out and says so.
5. Only if both fail does the visitor get an error, and every error state in the
   form ends with the contact email address.

## What it demonstrates

**Security**
- Token authentication, then a *separate* authorization check on which site the
  token belongs to (a leaked storefront token cannot write here).
- Server-side validation with length limits; field errors returned as 422 and
  shown beside the fields.
- Rate limiting per IP; honeypot answered with a normal success.
- Transactional writes with a tested rollback.
- The request ID header is untrusted input: stripped to safe characters and
  length-capped before it reaches the logs.
- Nonces do not apply: it is a token-authenticated JSON API with no cookie
  session, so there is no CSRF surface.

**Debugging and observability**
- Failures are logged with structured context at the right level.
- A browser-generated `X-Request-ID` is attached to every log line for that
  request, so a visitor's failed submission can be found in the logs or in an APM
  tool such as New Relic. (The ID reaches Laravel's logs; this sample does not
  include APM wiring.)
- The log holds **no personal data** when the enquiry is safe elsewhere (only the
  email domain, page and message length), and keeps the full payload only when
  both the CRM write and the notification have failed, because then the log is the
  only copy. Both behaviours have tests.

**Performance and resilience**
- A fetch timeout (`AbortController`) so a hung connection cannot leave the form
  stuck on "Sending…".
- The submit button is disabled while sending, so a double click cannot submit
  twice (tested).
- The CRM and notification paths are independent so one outage cannot lose an
  enquiry.

**Accessibility**
- Real `<label>`s, `aria-invalid` on failed fields, `role="alert"` for errors and
  `role="status"` for success.
- The honeypot is invisible to people and assistive technology without using
  `display: none`.

## Tests

| Layer | File | Count | Covers |
|---|---|---|---|
| API | `api/tests/Feature/Marketing/WebsiteEnquiryTest.php` | 22 | Token, site check, validation, honeypot (asserting the 200), three-record chain, name splitting, notification, partial and total failure, rollback, rate limit, log redaction, request ID sanitising |
| React | `web/src/components/enquiry-form.test.tsx` | 15 | URL handoff prefill, payload shape and headers, honeypot, success, 422 mapping, 500/503/429/403, network failure, double-submit, timeout |
| React | `web/src/lib/demo-handoff.test.ts` | 8 | Allow-listing and parsing of values carried in the URL |

## What was changed to make this a sample

- Company names, domains and the notification address were replaced with
  `mmuzammilq.com` details, and the API base URL defaults to `http://localhost:8000`.
- `web/src/lib/site.ts` is a trimmed stand-in for the real constants file.
- Nothing else was altered: the logic is as it runs in production.

## Known limitations

- The API folder cannot be run on its own (see above).
- The static token is public by design (it ships in a static build). It only
  identifies the site; the rate limit and honeypot do the real defending.
- No end-to-end test connects the form to the API; each side is tested against a
  mocked other side.
