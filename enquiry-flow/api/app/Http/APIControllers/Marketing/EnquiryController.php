<?php

declare(strict_types=1);

namespace App\Http\APIControllers\Marketing;

use App\Crm\Services\WebsiteEnquiryService;
use App\Http\Controllers\Controller;
use App\Support\SiteRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * The public enquiry endpoint — Book a Demo and Contact on the marketing site.
 *
 * THIS IS THE ONLY PUBLIC WRITE PATH ON THE MARKETING SITE. Every other
 * marketing endpoint reads. That makes it the one place an anonymous request
 * creates records, and everything unusual about this controller follows from
 * that.
 *
 * ── FOUR LAYERS, EACH DOING A DIFFERENT JOB ───────────────────────────────
 *
 *  1. STATIC TOKEN (route middleware). Proves the caller is the marketing
 *     site rather than a stranger with the URL. Not a strong secret — it ships
 *     inside a public static build — but it removes drive-by traffic.
 *  2. SITE CHECK (here). The token identifies WHICH site. Only the marketing
 *     site may post enquiries; the storefront token holds no authority here,
 *     so a leak of one does not become a way to write leads with the other.
 *  3. RATE LIMIT (route middleware). Per IP, per minute, deliberately low.
 *  4. HONEYPOT (here). A field a human never sees. Bots fill everything.
 *
 * ── THE HONEYPOT ANSWERS 200 ──────────────────────────────────────────────
 *
 * A caught bot gets the same success envelope a person does. An error, or a
 * different shape of response, tells whoever wrote the script exactly which
 * field gave them away and invites a second attempt that avoids it. Silence
 * that looks like success is the only response that does not teach anything.
 *
 * ── WHAT IT RETURNS TO THE VISITOR ────────────────────────────────────────
 *
 * 200 whenever the enquiry reached EITHER the CRM or the notification inbox
 * (WebsiteEnquiryService keeps those independent on purpose). Only a total
 * failure of both is a 500 — because that is the only case where asking the
 * visitor to try again is honest rather than a way to lose their message
 * twice.
 */
class EnquiryController extends Controller
{
    public function store(Request $request, WebsiteEnquiryService $enquiries): JsonResponse
    {
        // Layer 2. The token already authenticated SOMEBODY; this asks whether
        // it was the site allowed to write here.
        if (SiteRegistry::fromRequest($request) !== 'imflow360') {
            return response()->json([
                'status' => false,
                'message' => 'This endpoint is not available for this site.',
            ], 403);
        }

        // Correlation id from the browser (see enquiry-form.tsx). Shared with
        // every log line this request writes, so "the visitor says it failed
        // at 14:02" can be matched to a server log, a New Relic trace or both.
        // Sanitised because it is a header: length-capped, safe characters only.
        $requestId = substr((string) preg_replace('/[^A-Za-z0-9\-_]/', '', (string) $request->header('X-Request-ID')), 0, 64);

        if ($requestId !== '') {
            Log::withContext(['request_id' => $requestId]);
        }

        $honeypot = (string) config('marketing.enquiry.honeypot_field', 'company_website');

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email:rfc', 'max:190'],
            'phone' => ['nullable', 'string', 'max:40'],
            'business_name' => ['nullable', 'string', 'max:190'],
            'business_type' => ['nullable', 'string', 'max:60'],
            'message' => ['nullable', 'string', 'max:4000'],
            // Which page it came from. Recorded, never trusted for anything
            // but a note — it is a string from a browser.
            'page' => ['nullable', 'string', 'max:120'],
            $honeypot => ['nullable', 'string', 'max:190'],
        ]);

        // Layer 4. Anything in the honeypot means a bot filled a field no
        // human can see. Logged at debug so the rate can be observed without
        // filling the log with noise.
        if (filled($validated[$honeypot] ?? null)) {
            Log::debug('Website enquiry rejected by honeypot.', ['ip' => $request->ip()]);

            return $this->accepted(null);
        }

        unset($validated[$honeypot]);

        $result = $enquiries->record($validated);

        if ($result['lead_id'] === null && ! $result['notified']) {
            // Both paths failed. The service has already logged the payload,
            // so the enquiry is recoverable — but the visitor must be told,
            // because for them nothing happened.
            return response()->json([
                'status' => false,
                'message' => 'We could not record your enquiry. Please email us directly.',
            ], 500);
        }

        return $this->accepted($result['lead_id']);
    }

    /**
     * The success envelope.
     *
     * DELIBERATELY IDENTICAL whether a lead was created, only the notification
     * went, or a bot was silently dropped. The reference is included when
     * there is one, and its absence carries no information a caller can act
     * on — which is the point.
     */
    private function accepted(?int $leadId): JsonResponse
    {
        return response()->json([
            'status' => true,
            'message' => 'Thank you — we have received your enquiry and will be in touch.',
            'reference' => $leadId,
        ]);
    }
}
