<?php

/*
|--------------------------------------------------------------------------
| Marketing website
|--------------------------------------------------------------------------
|
| Settings for the marketing site — the public site whose job is branding the
| product. Separate from config/sites.php, which registers WHICH sites exist;
| this is what the marketing site DOES.
|
| Deliberately its own file rather than a section of config/crm.php: that file
| is being actively edited in the CRM lane, and a shared file is a merge
| conflict waiting to happen for no benefit.
|
*/

return [

    /*
     | The public enquiry form (Book a Demo, Contact).
     |
     | This is the ONLY public write path on the marketing site, which makes
     | it the only place an anonymous request can create a record. Everything
     | here exists because of that.
     */
    'enquiry' => [

        /*
         | The lead source recorded against every enquiry.
         |
         | 'Website Enquiry Form' is one of the thirteen sources seeded by
         | CrmPipelineBlueprint::SOURCES — this endpoint did not invent it.
         | crm_leads.source_id is NOT NULL and LeadService::create() refuses a
         | payload without one, on the grounds that "where did this lead come
         | from?" is answerable at the moment of entry and by nobody later.
         */
        'source_name' => env('MARKETING_ENQUIRY_SOURCE', 'Website Enquiry Form'),

        /*
         | Which user the lead is created AS.
         |
         | LeadService::create() takes a User and derives the business from
         | them (CrmQueryScope::businessIdFor). A public form has no
         | authenticated user, so one has to be nominated.
         |
         | Left null, the service finds the longest-standing user in the
         | internal (IMS) business. Set this explicitly in production so that
         | ownership of inbound leads is a decision rather than an accident of
         | which account was created first.
         */
        'actor_id' => env('MARKETING_ENQUIRY_ACTOR_ID'),

        /*
         | Where the notification goes. Falls back to the platform's own
         | contact address, because an enquiry reaching nobody is the failure
         | this whole feature exists to prevent.
         */
        'notify' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('MARKETING_ENQUIRY_NOTIFY', 'me@mmuzammilq.com'))
        ))),

        /*
         | The honeypot field name.
         |
         | A field a human never sees and never fills. Bots fill every input
         | they find, so a non-empty value here is a bot — and the response is
         | a normal-looking success, never an error. Telling a bot it was
         | detected just teaches whoever wrote it to try again differently.
         |
         | Named to look worth filling. `honeypot` or `_gotcha` are on every
         | scraper's skip list.
         */
        'honeypot_field' => env('MARKETING_ENQUIRY_HONEYPOT', 'company_website'),

        /*
         | Rate limit: attempts per minute, per IP.
         |
         | Low on purpose. A person fills this in once; the only thing that
         | needs six attempts a minute is a script.
         */
        'rate_limit' => (int) env('MARKETING_ENQUIRY_RATE_LIMIT', 6),
    ],

];
