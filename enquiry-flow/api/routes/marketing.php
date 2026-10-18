<?php

use App\Http\APIControllers\Marketing\EnquiryController;
use App\Http\APIControllers\Marketing\MarketingContentController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Marketing website — public routes
|--------------------------------------------------------------------------
|
| For the marketing site, the site that brands the product. Separate from
| routes/seo.php, which every site shares.
|
| Guarded by the static-token middleware (X-API-TOKEN header), which also
| resolves WHICH site is calling. The controller then requires that site to be
| `imflow360` — the storefront's token carries no authority here.
|
| Base URL: {APP_URL}/api/{API_PREFIX|v1}/imflow360/marketing
*/

$apiPrefix = env('API_PREFIX') ?? 'v1';

Route::prefix("api/{$apiPrefix}/imflow360/marketing")
    ->middleware([
        'imflow.web.static_token',

        /*
         | PER IP, PER MINUTE, and low on purpose.
         |
         | This is the only endpoint on the platform where an anonymous caller
         | creates records — a company, a contact and a lead per call. Without
         | a limit, one script fills the sales pipeline with garbage faster
         | than anyone can delete it, and the CRM becomes unusable rather than
         | merely noisy.
         |
         | A person submits once, twice if they mistype an email. Six a minute
         | is generous for a human and useless to a bot.
         */
        'throttle:'.((int) config('marketing.enquiry.rate_limit', 6)).',1',
    ])
    ->group(function (): void {
        // Book a Demo and Contact both post here. They are the same act from
        // the CRM's point of view — somebody asking to be contacted — and the
        // page they came from is recorded on the lead rather than split across
        // two endpoints that would drift apart.
        Route::post('enquiries', [EnquiryController::class, 'store'])
            ->name('api.marketing.enquiries.store');
    });

/*
|--------------------------------------------------------------------------
| Website content reads (build time)
|--------------------------------------------------------------------------
| A SEPARATE GROUP, WITHOUT THE ENQUIRY THROTTLE. These are read by the
| marketing site's `next build` — once per export worker — and by nothing
| else. Six-a-minute is right for a form that creates CRM records and wrong
| for a build that fetches content; sharing the group would make a deploy
| fail with HTTP 429 the day a second read endpoint is added.
|
| Guarded by the static-token middleware like the SEO and legal reads: the
| token names the site, so the marketing build can only ever read its own
| rows.
*/
Route::prefix("api/{$apiPrefix}/imflow360/marketing")
    ->middleware(['imflow.web.static_token'])
    ->group(function (): void {
        // Every FAQ route the site has rows for, with its published items.
        Route::get('faqs', [MarketingContentController::class, 'faqs'])
            ->name('api.marketing.faqs');

        // Overridden copy slots (hero eyebrow/title/lead, closing title/body)
        // per page — only the fields an editor has changed.
        Route::get('copy', [MarketingContentController::class, 'copy'])
            ->name('api.marketing.copy');
    });
