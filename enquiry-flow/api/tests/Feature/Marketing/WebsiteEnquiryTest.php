<?php

declare(strict_types=1);

namespace Tests\Feature\Marketing;

use App\Crm\Models\Company;
use App\Crm\Models\Contact;
use App\Crm\Models\Lead;
use App\Crm\Models\LeadStatus;
use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use App\Notifications\WebsiteEnquiryReceived;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Tests\Concerns\CrmTestContext;
use Tests\TestCase;

/**
 * The public enquiry endpoint — the ONLY place on this platform where an
 * anonymous request creates records.
 *
 * That is the whole reason this file is long. A bug here is not a broken page;
 * it is either a stranger writing into the CRM, or — worse and quieter — a
 * lead the business never finds out about.
 *
 * WHAT EACH GROUP DEFENDS
 *
 *  1. THE FOUR GATES. Token, site, honeypot, validation. The site check is the
 *     one worth reading: the storefront's token authenticates fine and must
 *     still be refused here, so leaking one site's token does not become a way
 *     to write the other's records.
 *  2. THE HONEYPOT ANSWERS 200. Asserting the STATUS as well as the absence of
 *     a lead, because an error response would tell whoever wrote the bot which
 *     field caught them. A test that only checked "no lead was created" would
 *     pass on a 422 and miss the point entirely.
 *  3. ONE ENQUIRY IS THREE RECORDS. Company -> Contact -> Lead, linked. A lead
 *     with a null contact_id is invisible in exactly the reports built to stop
 *     things being forgotten, and would look fine in a test that only counted
 *     leads.
 *  4. AN ENQUIRY IS NEVER SILENTLY LOST. The last group is the most important
 *     in the file: with the CRM deliberately broken, the endpoint must still
 *     succeed and still send the mail. A form that swallows an enquiry is
 *     worse than one that visibly breaks, because nobody finds out.
 */
class WebsiteEnquiryTest extends TestCase
{
    use CrmTestContext;
    use DatabaseTransactions;

    private const URL = '/api/v1/imflow360/marketing/enquiries';

    private const MARKETING_TOKEN = 'test-marketing-token-not-a-real-one';

    private const STOREFRONT_TOKEN = 'test-storefront-token-not-a-real-one';

    private Business $ims;

    protected function setUp(): void
    {
        parent::setUp();

        // Two DISTINCT tokens. SiteRegistry throws on an ambiguous one, so
        // reusing a value here would fail in a way that looks unrelated.
        config([
            'sites.sites.imflow360.token' => self::MARKETING_TOKEN,
            'dindin.web.public_api_token' => self::STOREFRONT_TOKEN,
            'marketing.enquiry.notify' => ['me@mmuzammilq.com'],
        ]);

        $this->ims = $this->makeCrmBusiness('Innovation M Services');
        $this->ims->forceFill(['is_internal' => true])->save();

        $actor = $this->makeCrmUser($this->ims, 'Rosa Alvarez');
        config(['marketing.enquiry.actor_id' => $actor->id]);

        // The source the service resolves BY NAME. Seeded by
        // CrmPipelineBlueprint in a real installation.
        $this->makeSource($this->ims, 'Website Enquiry Form');

        // AND AN OPEN STATUS. LeadService::defaultStatus() throws when
        // crm_lead_statuses holds no active OPEN row, so without this every
        // lead write fails — while the endpoint still answers 200, because the
        // notification path succeeds independently. That is the feature
        // working as designed and it made the first run of this file
        // confusing: nine failures, all one missing fixture.
        $this->makeStatus($this->ims, 'New');

        Notification::fake();
    }

    /** @param array<string, mixed> $payload */
    private function submit(array $payload, ?string $token = self::MARKETING_TOKEN)
    {
        $headers = ['Accept' => 'application/json'];

        if ($token !== null) {
            $headers['X-API-TOKEN'] = $token;
        }

        return $this->postJson(self::URL, $payload, $headers);
    }

    /** @return array<string, mixed> */
    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Ayesha Khan',
            'email' => 'ayesha@glowsalon.test',
            'phone' => '0300 1234567',
            'business_name' => 'Glow Salon',
            'business_type' => 'Salon or spa',
            'message' => 'Two branches, six chairs.',
            'page' => 'Book a demo',
        ], $overrides);
    }

    /* ------------------------------------------------------------------ */
    /* 1. The gates                                                        */
    /* ------------------------------------------------------------------ */

    public function test_it_refuses_a_request_with_no_token(): void
    {
        $this->submit($this->validPayload(), token: null)->assertStatus(401);

        $this->assertSame(0, Lead::withoutGlobalScopes()->count());
    }

    public function test_it_refuses_an_unknown_token(): void
    {
        $this->submit($this->validPayload(), token: 'not-a-configured-token')->assertStatus(401);
    }

    /**
     * THE SITE CHECK. The storefront's token is valid — it authenticates
     * against every other public route — and must still be refused here.
     * Without this, one leaked token would be authority over both websites.
     */
    public function test_the_storefront_token_authenticates_but_may_not_post_an_enquiry(): void
    {
        $this->submit($this->validPayload(), token: self::STOREFRONT_TOKEN)
            ->assertStatus(403);

        $this->assertSame(0, Lead::withoutGlobalScopes()->count());
    }

    public function test_it_validates_the_fields_a_lead_cannot_do_without(): void
    {
        $this->submit(['name' => '', 'email' => 'not-an-email'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'email']);
    }

    /* ------------------------------------------------------------------ */
    /* 2. The honeypot                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * A filled honeypot gets the SAME success envelope a person gets.
     *
     * Both halves are asserted on purpose. Checking only that no lead was
     * created would pass if the endpoint returned a 422 — and a distinctive
     * error is precisely what tells whoever wrote the bot which field to leave
     * alone next time.
     */
    public function test_a_filled_honeypot_is_answered_with_success_and_writes_nothing(): void
    {
        $field = (string) config('marketing.enquiry.honeypot_field', 'company_website');

        $this->submit($this->validPayload([$field => 'http://bot-link.invalid']))
            ->assertOk()
            ->assertJson(['status' => true, 'reference' => null]);

        $this->assertSame(0, Lead::withoutGlobalScopes()->count());
        $this->assertSame(0, Contact::withoutGlobalScopes()->count());
        Notification::assertNothingSent();
    }

    /* ------------------------------------------------------------------ */
    /* 3. One enquiry is three linked records                              */
    /* ------------------------------------------------------------------ */

    public function test_it_creates_a_linked_company_contact_and_lead(): void
    {
        $this->submit($this->validPayload())
            ->assertOk()
            ->assertJson(['status' => true]);

        $lead = Lead::withoutGlobalScopes()->latest('id')->first();
        $this->assertNotNull($lead);

        $company = Company::withoutGlobalScopes()->find($lead->company_id);
        $contact = Contact::withoutGlobalScopes()->find($lead->contact_id);

        $this->assertNotNull($company, 'the lead must be linked to a company');
        $this->assertNotNull($contact, 'the lead must be linked to a contact');

        $this->assertSame('Glow Salon', $company->name);
        $this->assertSame('Glow Salon', $lead->title, 'the business name titles the lead');
        $this->assertSame('ayesha@glowsalon.test', $contact->email);
        $this->assertSame((int) $company->id, (int) $contact->company_id);

        // Filed against the internal business, not a tenant.
        $this->assertSame((int) $this->ims->id, (int) $lead->business_id);
    }

    public function test_the_name_is_split_across_the_two_contact_columns(): void
    {
        $this->submit($this->validPayload())->assertOk();

        $contact = Contact::withoutGlobalScopes()->latest('id')->first();

        $this->assertSame('Ayesha', $contact->first_name);
        $this->assertSame('Khan', $contact->last_name);
    }

    /** A stranger with one name is not an error, and must not become one. */
    public function test_a_single_word_name_is_accepted(): void
    {
        $this->submit($this->validPayload(['name' => 'Cher']))->assertOk();

        $contact = Contact::withoutGlobalScopes()->latest('id')->first();

        $this->assertSame('Cher', $contact->first_name);
        $this->assertNull($contact->last_name);
    }

    /**
     * No business name is the common case on a contact form, and it must still
     * produce a complete, reachable lead.
     *
     * The company is named after the person. That is forced by the schema —
     * `crm_contacts.company_id` is NOT NULL, and `crm_leads` has no email or
     * phone column — so the alternative is an enquiry whose contact details
     * survive only as free text. The salesperson's first act is to reply, so
     * losing the email is not an option.
     */
    public function test_without_a_business_name_the_company_is_named_after_the_person(): void
    {
        $this->submit($this->validPayload(['business_name' => null]))->assertOk();

        $lead = Lead::withoutGlobalScopes()->latest('id')->first();
        $this->assertNotNull($lead);

        $company = Company::withoutGlobalScopes()->find($lead->company_id);
        $contact = Contact::withoutGlobalScopes()->find($lead->contact_id);

        $this->assertNotNull($company);
        $this->assertNotNull($contact);
        $this->assertSame('Ayesha Khan', $company->name);
        $this->assertSame('Ayesha Khan', $lead->title);

        // The email is what makes the lead actionable, and it is structured
        // rather than buried in prose.
        $this->assertSame('ayesha@glowsalon.test', $contact->email);
    }

    /**
     * And the lead must SAY the company name was inferred. Otherwise a
     * salesperson reads it as something the enquirer typed and greets them as
     * a business that does not exist under that name.
     */
    public function test_an_inferred_company_name_is_disclosed_on_the_lead(): void
    {
        $this->submit($this->validPayload(['business_name' => null]))->assertOk();

        $lead = Lead::withoutGlobalScopes()->latest('id')->first();

        $this->assertStringContainsString('No business name was given', (string) $lead->requirements);
    }

    /** The converse: a real business name is never described as inferred. */
    public function test_a_given_business_name_is_not_flagged_as_inferred(): void
    {
        $this->submit($this->validPayload())->assertOk();

        $lead = Lead::withoutGlobalScopes()->latest('id')->first();

        $this->assertStringNotContainsString('No business name was given', (string) $lead->requirements);
    }

    public function test_the_message_and_context_reach_the_salesperson(): void
    {
        $this->submit($this->validPayload())->assertOk();

        $lead = Lead::withoutGlobalScopes()->latest('id')->first();

        $this->assertStringContainsString('Two branches, six chairs.', (string) $lead->requirements);
        $this->assertStringContainsString('Salon or spa', (string) $lead->requirements);
        $this->assertStringContainsString('Book a demo', (string) $lead->requirements);
    }

    public function test_it_notifies_someone(): void
    {
        $this->submit($this->validPayload())->assertOk();

        Notification::assertSentOnDemand(WebsiteEnquiryReceived::class);
    }

    /* ------------------------------------------------------------------ */
    /* 4. An enquiry is never silently lost                                */
    /* ------------------------------------------------------------------ */

    /**
     * THE MOST IMPORTANT TEST IN THIS FILE.
     *
     * With the CRM unable to accept the lead — here, an actor id pointing at
     * nobody — the visitor must still be told their enquiry was received, and
     * the notification must still carry it. Otherwise a misconfiguration on a
     * fresh install silently drops every enquiry while the form looks fine.
     *
     * Note this is the realistic failure, not a contrived one:
     * ImsBusinessSeeder deliberately creates no user inside the internal
     * business, so a production install that never sets
     * MARKETING_ENQUIRY_ACTOR_ID lands exactly here.
     */
    public function test_when_the_crm_cannot_accept_the_lead_the_enquiry_still_reaches_a_human(): void
    {
        config(['marketing.enquiry.actor_id' => 999_999]);

        $this->submit($this->validPayload())
            ->assertOk()
            ->assertJson(['status' => true, 'reference' => null]);

        $this->assertSame(0, Lead::withoutGlobalScopes()->count(), 'no half-written lead');
        Notification::assertSentOnDemand(WebsiteEnquiryReceived::class);
    }

    /**
     * And the mail must SAY it failed. A notification identical to the happy
     * path would leave somebody assuming the lead is in the CRM, which is how
     * an enquiry gets lost with an email sitting in an inbox proving it
     * arrived.
     */
    public function test_the_failure_notification_says_the_lead_was_not_saved(): void
    {
        config(['marketing.enquiry.actor_id' => 999_999]);

        $this->submit($this->validPayload())->assertOk();

        // The failure state is on the notification object, so the assertion
        // can read it directly rather than trusting a rendered string.
        Notification::assertSentOnDemand(
            WebsiteEnquiryReceived::class,
            function (WebsiteEnquiryReceived $notification): bool {
                return $notification->failure !== null
                    && str_contains($notification->subject(), 'NOT saved');
            },
        );
    }

    /**
     * A missing source is the other realistic misconfiguration —
     * CrmSourceSeeder not having run. Same contract.
     */
    public function test_a_missing_lead_source_does_not_swallow_the_enquiry(): void
    {
        config(['marketing.enquiry.source_name' => 'A Source That Does Not Exist']);

        $this->submit($this->validPayload())
            ->assertOk()
            ->assertJson(['reference' => null]);

        $this->assertSame(0, Lead::withoutGlobalScopes()->count());
        Notification::assertSentOnDemand(WebsiteEnquiryReceived::class);
    }

    /**
     * The chain is one transaction: a contact with no lead sits in no queue
     * and appears in no report, so half of it must not survive a failure.
     */
    public function test_a_failed_lead_write_rolls_back_the_company_and_contact(): void
    {
        /*
         * THE FAILURE HAS TO HAPPEN INSIDE THE TRANSACTION, or this test does
         * not test what its name claims.
         *
         * An earlier version used a missing SOURCE — but the source is
         * resolved BEFORE DB::transaction() opens, so nothing was ever
         * written and the assertions below passed without the rollback
         * existing at all. A test that cannot fail for its stated reason is
         * worse than no test: it reports safety it never checked.
         *
         * Removing the lead STATUS instead puts the failure where it belongs.
         * The company and contact are written, then LeadService::defaultStatus()
         * throws, and only a working rollback removes them.
         */
        LeadStatus::query()->withoutGlobalScopes()->delete();

        $this->submit($this->validPayload())
            ->assertOk()
            ->assertJson(['reference' => null]);

        $this->assertSame(0, Company::withoutGlobalScopes()->count(), 'the company must roll back');
        $this->assertSame(0, Contact::withoutGlobalScopes()->count(), 'the contact must roll back');
        $this->assertSame(0, Lead::withoutGlobalScopes()->count());

        // And the enquiry still reached a human.
        Notification::assertSentOnDemand(WebsiteEnquiryReceived::class);
    }

    /**
     * With nowhere to send the mail AND no CRM, the visitor must be told —
     * this is the one case where "please try again" is honest rather than a
     * way to lose their message twice.
     */
    public function test_a_total_failure_is_reported_to_the_visitor(): void
    {
        config([
            'marketing.enquiry.actor_id' => 999_999,
            'marketing.enquiry.notify' => [],
        ]);

        $this->submit($this->validPayload())
            ->assertStatus(500)
            ->assertJson(['status' => false]);
    }

    /* ------------------------------------------------------------------ */
    /* 5. Abuse limits and what the logs may hold                          */
    /* ------------------------------------------------------------------ */

    /**
     * The throttle is the only thing between one script and a pipeline full
     * of junk, and it is configured in a route file nobody reads again. A
     * honeypot payload is used so the six allowed calls create no records.
     */
    public function test_the_seventh_request_in_a_minute_is_rate_limited(): void
    {
        $limit = (int) config('marketing.enquiry.rate_limit', 6);
        $bot = $this->validPayload([(string) config('marketing.enquiry.honeypot_field', 'company_website') => 'x']);

        for ($i = 0; $i < $limit; $i++) {
            $this->submit($bot)->assertOk();
        }

        $this->submit($bot)->assertStatus(429);
    }

    /**
     * A name, email and message in a log file outlive the mail that already
     * carries them. When the CRM fails but the mail goes, the log must hold
     * only what correlates the line to an enquiry.
     */
    public function test_a_crm_failure_does_not_write_the_visitors_details_to_the_log(): void
    {
        Log::spy();
        config(['marketing.enquiry.actor_id' => 999_999]);

        $this->submit($this->validPayload())->assertOk();

        Log::shouldHaveReceived('error')->withArgs(function (string $message, array $context): bool {
            $logged = json_encode($context);

            return str_contains($message, 'could not be written to the CRM')
                && ! str_contains($logged, 'Ayesha')
                && ! str_contains($logged, 'ayesha@glowsalon.test')
                && ! str_contains($logged, 'Two branches')
                && str_contains($logged, 'glowsalon.test'); // the domain is kept
        })->once();
    }

    /**
     * The one case where the log IS the only copy: CRM and mail both failed.
     * Redacting here would turn "recoverable" into "lost".
     */
    public function test_when_nothing_else_holds_the_enquiry_the_log_keeps_it(): void
    {
        Log::spy();
        config([
            'marketing.enquiry.actor_id' => 999_999,
            'marketing.enquiry.notify' => [],
        ]);

        $this->submit($this->validPayload())->assertStatus(500);

        Log::shouldHaveReceived('warning')->withArgs(
            fn (string $message, array $context): bool => str_contains(json_encode($context), 'ayesha@glowsalon.test'),
        )->once();
    }

    /** The request id is a header, so it is untrusted: stripped to safe characters. */
    public function test_a_request_id_header_is_attached_to_the_log_context_sanitised(): void
    {
        Log::spy();

        $this->postJson(self::URL, $this->validPayload(), [
            'Accept' => 'application/json',
            'X-API-TOKEN' => self::MARKETING_TOKEN,
            'X-Request-ID' => "abc-123\n<script>",
        ])->assertOk();

        Log::shouldHaveReceived('withContext')->with(['request_id' => 'abc-123script'])->once();
    }
}
