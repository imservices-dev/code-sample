<?php

declare(strict_types=1);

namespace App\Crm\Services;

use App\Crm\Models\Company;
use App\Crm\Models\Contact;
use App\Crm\Models\Source;
use App\Crm\Support\CrmQueryScope;
use App\Models\Business;
use App\Models\User;
use App\Notifications\WebsiteEnquiryReceived;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use RuntimeException;
use Throwable;

/**
 * Turns a submission from the marketing site into a CRM lead.
 *
 * ── THE ONE RULE THIS CLASS IS BUILT AROUND ───────────────────────────────
 *
 * AN ENQUIRY MUST NEVER BE SILENTLY LOST. A marketing site exists to produce
 * these; a form that swallows one is worse than a form that visibly breaks,
 * because nobody finds out. So the CRM write and the notification are
 * INDEPENDENT: if the CRM cannot accept the enquiry — no internal business
 * yet, no source seeded, nobody to attribute it to — the notification is
 * still sent, carrying the full submission and saying plainly that it did not
 * reach the CRM. Somebody can act on it by hand and fix the cause.
 *
 * The visitor is told "received" whenever at least one of those landed. Our
 * internal plumbing is not their problem, and asking them to retype it would
 * lose the enquiry just as surely.
 *
 * ── AN ENQUIRY IS THREE RECORDS, NOT ONE ──────────────────────────────────
 *
 * `crm_leads` holds no name, email or phone: those live on `crm_contacts`,
 * which in turn hangs off `crm_companies`. So one submission becomes
 * Company (when a business name was given) → Contact → Lead, in that order,
 * inside a single transaction. Half of that chain is worse than none — a
 * contact with no lead sits in no queue and appears in no report.
 *
 * ── WHY IT GOES THROUGH THE SERVICES AND NOT RAW INSERTS ──────────────────
 *
 * LeadService::create() writes the creation activity, applies the default
 * status and enforces the NOT NULL columns; ContactService and CompanyService
 * do the equivalent. Raw inserts would produce records that never appear in
 * the follow-up buckets and have no history — invisible in exactly the
 * reports built to make sure nothing is forgotten.
 */
final class WebsiteEnquiryService
{
    public function __construct(
        private readonly LeadService $leads,
        private readonly ContactService $contacts,
        private readonly CompanyService $companies,
    ) {
    }

    /**
     * @param  array{name:string,email:string,phone?:?string,business_name?:?string,business_type?:?string,message?:?string,page?:?string}  $data
     * @return array{lead_id:?int,notified:bool}
     */
    public function record(array $data): array
    {
        $leadId = null;
        $failure = null;

        try {
            $leadId = $this->createLead($data);
        } catch (Throwable $e) {
            $failure = $e->getMessage();

            // Loud, but WITHOUT the visitor's details: the notification below
            // carries them, and a name, email and message have no business
            // sitting in a log file that outlives the mail. If the mail fails
            // too, notify() logs the full payload — the one case where the log
            // is the only copy of the enquiry.
            Log::error('Website enquiry could not be written to the CRM.', [
                'error' => $e->getMessage(),
                'enquiry' => $this->redacted($data),
            ]);
        }

        $notified = $this->notify($data, $leadId, $failure);

        return ['lead_id' => $leadId, 'notified' => $notified];
    }

    /** @param array<string, mixed> $data */
    private function createLead(array $data): int
    {
        $actor = $this->actor();
        $source = $this->source($actor);

        // ONE TRANSACTION for the whole chain. A contact with no lead is a
        // record in no queue: nobody is asked to follow it up, and it appears
        // in no report. Better to keep nothing and let the notification carry
        // the enquiry than to leave an orphan somebody has to notice.
        return DB::transaction(function () use ($data, $actor, $source): int {
            $given = trim((string) ($data['business_name'] ?? ''));
            $person = trim((string) $data['name']);

            /*
             * A COMPANY IS ALWAYS CREATED, EVEN WHEN NONE WAS GIVEN.
             *
             * `crm_contacts.company_id` is NOT NULL with a foreign key, and
             * the table's own docblock states the rule: "a contact without a
             * company is a lead, not a contact". ContactService enforces it.
             *
             * So a company-less enquiry has nowhere to put an email or a
             * phone number — `crm_leads` has neither column. The choice is
             * between naming a company after the person and losing their
             * contact details to a free-text field, and losing the details is
             * not a real option: the salesperson's first act is to reply.
             *
             * Naming it after the person is also usually TRUE rather than a
             * convenience. Somebody enquiring about a point-of-sale system
             * without typing a business name is generally a sole trader or
             * someone who skipped an optional field, and in both cases the
             * person is the business.
             *
             * The LEAD still shows the business name when one was given, so a
             * pipeline list reads as a list of businesses, not of people.
             */
            $companyName = $given !== '' ? $given : $person;

            $company = $this->companies->create(['name' => $companyName], $actor);

            [$first, $last] = $this->splitName($person);

            $contact = $this->contacts->create([
                'company_id' => $company->id,
                'first_name' => $first,
                'last_name' => $last,
                'email' => $data['email'],
                'mobile' => $data['phone'] ?? null,
                'is_primary' => true,
            ], $actor);

            $lead = $this->leads->create([
                'title' => $companyName,
                'company_id' => $company->id,
                'contact_id' => $contact->id,
                'source_id' => $source->id,
                'requirements' => $this->requirements($data, $given === ''),
            ], $actor);

            return (int) $lead->id;
        });
    }

    /**
     * "Ayesha Khan" -> ['Ayesha', 'Khan']; "Cher" -> ['Cher', null].
     *
     * A single free-text name field is the right thing to ask a stranger for,
     * and splitting on the last space is the least-wrong way to fit it to a
     * two-column table. It gets "Maria del Carmen Ruiz" wrong in the way every
     * such split does; a salesperson can fix it in one edit, which is cheaper
     * than asking every visitor to fill two boxes.
     *
     * @return array{0:string,1:?string}
     */
    private function splitName(string $name): array
    {
        $name = trim(preg_replace('/\s+/', ' ', $name) ?? $name);

        if (! str_contains($name, ' ')) {
            return [$name, null];
        }

        $parts = explode(' ', $name);
        $last = array_pop($parts);

        return [implode(' ', $parts), $last];
    }

    /**
     * The user the lead is created as.
     *
     * NOT nullable-and-carry-on: LeadService derives the BUSINESS from this
     * user, so getting it wrong files the enquiry against the wrong tenant.
     * Better to fail the CRM write and let the notification carry the enquiry
     * than to guess.
     */
    private function actor(): User
    {
        $configured = config('marketing.enquiry.actor_id');

        if ($configured !== null && $configured !== '') {
            $user = User::query()->withoutGlobalScopes()->find((int) $configured);

            if (! $user) {
                throw new RuntimeException(
                    'marketing.enquiry.actor_id is set to '.$configured.' but no such user exists.'
                );
            }

            return $user;
        }

        $business = $this->internalBusiness();

        $user = User::query()->withoutGlobalScopes()
            ->where('business_id', $business->id)
            ->orderBy('id')
            ->first();

        if (! $user) {
            throw new RuntimeException(
                'No user belongs to the internal (IMS) business, so a website enquiry cannot be '
                .'attributed. Create one by following docs/deploy/ims-admin-user-on-production.md, '
                .'then set MARKETING_ENQUIRY_ACTOR_ID to that user id. '
                .'(ImsBusinessSeeder deliberately creates the business but no user, and the '
                .'internal business is hidden from the super-admin list, so there is no screen '
                .'for this yet.)'
            );
        }

        return $user;
    }

    private function internalBusiness(): Business
    {
        $business = Business::query()->withoutGlobalScopes()
            ->where('is_internal', true)
            ->first();

        if (! $business) {
            throw new RuntimeException(
                'The internal (IMS) business does not exist. Run ImsBusinessSeeder.'
            );
        }

        return $business;
    }

    /**
     * The 'Website Enquiry Form' source, scoped to the actor's business.
     *
     * Resolved by NAME, not by a stored id: ids differ per installation, and
     * the name is what CrmPipelineBlueprint seeds and what a salesperson sees
     * in the dropdown.
     */
    private function source(User $actor): Source
    {
        $name = (string) config('marketing.enquiry.source_name', 'Website Enquiry Form');
        $businessId = CrmQueryScope::businessIdFor($actor);

        $source = Source::query()->withoutGlobalScopes()
            ->where('business_id', $businessId)
            ->where('name', $name)
            ->first();

        if (! $source) {
            throw new RuntimeException(
                "The lead source [{$name}] does not exist for business {$businessId}. "
                .'Run CrmSourceSeeder, or set MARKETING_ENQUIRY_SOURCE to a source that exists.'
            );
        }

        return $source;
    }

    /**
     * Everything the visitor typed, in the one free-text field the lead has.
     *
     * `requirements` rather than a note: it is on LeadService::EDITABLE, it is
     * what a salesperson reads first, and it survives conversion to a deal.
     *
     * @param array<string, mixed> $data
     */
    private function requirements(array $data, bool $companyInferred = false): string
    {
        $lines = [];

        if (filled($data['message'] ?? null)) {
            $lines[] = (string) $data['message'];
            $lines[] = '';
        }

        // SAY SO WHEN THE COMPANY NAME WAS NOT GIVEN. A salesperson opening
        // this lead would otherwise read the company as something the
        // enquirer typed, and might greet them as a business that does not
        // exist under that name.
        if ($companyInferred) {
            $lines[] = 'No business name was given — the company was named after the enquirer.';
        }

        foreach ([
            'Business type' => $data['business_type'] ?? null,
            'Enquired from' => $data['page'] ?? null,
        ] as $label => $value) {
            if (filled($value)) {
                $lines[] = $label.': '.$value;
            }
        }

        return trim(implode("\n", $lines));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return bool whether the notification was sent
     */
    private function notify(array $data, ?int $leadId, ?string $failure): bool
    {
        /** @var list<string> $to */
        $to = (array) config('marketing.enquiry.notify', []);

        if ($to === []) {
            Log::warning('Website enquiry: no notification recipients configured.', [
                'enquiry' => $this->recoverable($data, $leadId),
            ]);

            return false;
        }

        try {
            /*
             * BREVO, NOT THE MAILER.
             *
             * Laravel's mail stack is not configured from `.env` on this
             * installation: CustomConfigProvider:29,56 reads the
             * `email_settings` TABLE at boot and overwrites `mail.default`
             * and the SMTP credentials. That row holds seeded placeholders,
             * so every send failed with a 535 — the enquiry reached the CRM
             * and the notification did not, which is precisely the
             * half-failure this class exists to prevent.
             *
             * Brevo is the path the platform already sends real mail on
             * (BrevoChannel, five existing notifications, keyed on
             * BREVO_API_KEY). One working path beats two, and it removes a
             * per-install setup step nobody would remember for a marketing
             * form.
             *
             * `Notification::route('mail', ...)` with the first recipient is
             * the shape the existing callers use; the notification itself
             * addresses every configured recipient in its `to` payload.
             */
            Notification::route('mail', $to[0])
                ->notify(new WebsiteEnquiryReceived($data, $leadId, $failure));

            return true;
        } catch (Throwable $e) {
            // The mail failed. If the CRM write also failed ($leadId is null)
            // this log is the only copy of the enquiry, so it keeps the
            // payload; otherwise the lead holds it and the log stays redacted.
            Log::error('Website enquiry notification could not be sent.', [
                'error' => $e->getMessage(),
                'enquiry' => $this->recoverable($data, $leadId),
            ]);

            return false;
        }
    }

    /**
     * The payload to log when the enquiry may exist nowhere else.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function recoverable(array $data, ?int $leadId): array
    {
        return $leadId === null ? $data : $this->redacted($data);
    }

    /**
     * Enough to correlate a log line with an enquiry, nothing that identifies
     * the visitor: no name, phone, business or message text.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function redacted(array $data): array
    {
        $email = (string) ($data['email'] ?? '');

        return [
            'email_domain' => str_contains($email, '@') ? substr(strrchr($email, '@'), 1) : null,
            'business_type' => $data['business_type'] ?? null,
            'page' => $data['page'] ?? null,
            'message_length' => mb_strlen((string) ($data['message'] ?? '')),
        ];
    }
}
