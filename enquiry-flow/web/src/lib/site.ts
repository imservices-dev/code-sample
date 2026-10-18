/**
 * Trimmed copy of the production `lib/site.ts`, reduced to the four values the
 * enquiry form imports so this sample builds and tests on its own. The real
 * file also holds navigation, legal identity and SEO constants.
 */

export const SITE = {
  name: 'Muzammil Qureshi',
  /** Shown as the fallback whenever the API cannot take an enquiry. */
  email: 'me@mmuzammilq.com',
} as const;

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

/**
 * NOT A SECRET. Compiled into a public static build; it only tells the API
 * which site is calling. The rate limit and honeypot are the real defences.
 */
export const API_STATIC_TOKEN = process.env.NEXT_PUBLIC_API_STATIC_TOKEN ?? '';

/**
 * Must match config('marketing.enquiry.honeypot_field') on the server. `||`,
 * not `??`: an unset CI secret arrives as an empty string, and `??` would keep
 * it, rendering `<input name="">` and silently disabling the spam trap.
 */
export const ENQUIRY_HONEYPOT_FIELD = process.env.NEXT_PUBLIC_ENQUIRY_HONEYPOT || 'company_website';
