/**
 * Carrying a pricing-page selection into the Book a Demo form.
 *
 * /pricing has two ways into /book-demo/: a package card's "Book a Demo"
 * (package + how-you-pay + that card's starting price), and the calculator's
 * "Book a demo with this setup" (everything the calculator knows). Both
 * build their link here, and components/enquiry-form.tsx reads it back
 * here, so the two ends cannot disagree about a parameter name.
 *
 * ── WHY A QUERY STRING ────────────────────────────────────────────────────
 *
 * This is a static export (`output: 'export'`): no server, no session. The
 * URL is the only thing that survives a page navigation without a cookie or
 * browser storage, and /privacy says this site sets no cookies.
 *
 * ── PRICES TRAVEL IN BOTH CURRENCIES ──────────────────────────────────────
 *
 * The links are rendered as static HTML, before the visitor's currency is
 * known (lib/currency.ts decides that in the browser). So every price goes
 * in both forms — `price_pkr`/`price_usd`, `est_pkr`/`est_usd` — and the form
 * picks one after mount by reading the same `data-cur` attribute the CSS
 * toggle uses.
 *
 * ── WHAT THE BACKEND ACTUALLY STORES ──────────────────────────────────────
 *
 * EnquiryController validates a fixed list of fields and keeps only those —
 * anything else in the payload is silently dropped. So none of this becomes
 * a new database column: the form folds the package and payment choice into
 * `message` on submit, and the configuration summary is prefilled into the
 * message box where the visitor can see and edit it. `message` lands on the
 * CRM lead's `requirements`, which is what a salesperson reads first.
 */

export const PRICING_MODEL_NAMES = ['Monthly', 'Flexible', 'Revenue-Based'] as const;

export type PricingModelName = (typeof PRICING_MODEL_NAMES)[number];

export const PACKAGE_NAMES = ['Starter', 'Growth', 'Premium', 'Managed Operations'] as const;

type HandoffValue = string | number | null | undefined;

/** Build a /book-demo/ link carrying the given selection. Empty values are left out. */
export function demoHref(params: Record<string, HandoffValue>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  }

  const qs = query.toString();

  return qs ? `/book-demo/?${qs}` : '/book-demo/';
}

export type DemoHandoff = {
  pricingModel: string | null;
  packageName: string | null;
  /** Lines for the prefilled message box. Empty when nothing was carried over. */
  summary: string[];
};

function whole(value: string | null): number | null {
  if (value === null) return null;

  const n = Number(value);

  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * Read a selection back out of the URL. `currency` is the visitor's display
 * currency, read by the caller from `data-cur` after mount.
 */
export function readDemoHandoff(search: string, currency: 'pkr' | 'usd'): DemoHandoff {
  const q = new URLSearchParams(search);
  const pick = (pkr: string, usd: string) => q.get(currency === 'usd' ? usd : pkr);
  const money = currency === 'usd' ? '$' : 'PKR ';

  const model = q.get('model');
  const pkg = q.get('package');
  const pricingModel = model && (PRICING_MODEL_NAMES as readonly string[]).includes(model) ? model : null;
  const packageName = pkg && (PACKAGE_NAMES as readonly string[]).includes(pkg) ? pkg : null;

  const summary: string[] = [];
  const price = pick('price_pkr', 'price_usd');
  const estimate = pick('est_pkr', 'est_usd');
  const billing = q.get('billing');
  const branches = whole(q.get('branches'));
  const tills = whole(q.get('extra_tills'));
  const users = whole(q.get('extra_users'));
  const displays = whole(q.get('displays'));
  const revenue = whole(q.get('revenue'));

  if (price) summary.push(`Starting price shown: ${price}`);
  if (billing === 'annual' || billing === 'monthly') summary.push(`Billing: ${billing}`);
  if (branches !== null) summary.push(`Branches: ${branches}`);
  if (tills !== null) summary.push(`Extra tills per branch: ${tills}`);
  if (users !== null) summary.push(`Extra users per branch: ${users}`);
  if (displays !== null) summary.push(`Customer displays per branch: ${displays}`);
  if (revenue !== null && revenue > 0) summary.push(`Estimated monthly revenue: ${money}${revenue.toLocaleString('en-US')}`);
  if (estimate) summary.push(`Calculator estimate: ${estimate}`);

  return { pricingModel, packageName, summary };
}
