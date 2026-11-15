# Customer installations and integrations

See also: [Automations](automations.md) and [Hiring integrations](hiring-integrations.md) for the detail behind the capability list below. The one-organization-per-installation rule is the current design, not a permanent constraint.

STARSHIP is currently designed as one organization per installation. It is not a shared multi-company workspace: Firestore collections, organization settings and service credentials are global to an installation. Do not connect two companies to the same Firebase project or deploy them using the same storage bucket and service accounts.

## Provision a customer

1. Create a distinct deployment, Firebase project, authentication configuration, Firestore database and storage bucket for the customer. Use distinct service credentials, application URL, scheduler authorization, and any connected external service accounts. Restrict access to the customer and authorized operators.
2. Configure the customer's initial administrator with `BOOTSTRAP_ADMIN_EMAIL` and optionally `BOOTSTRAP_ADMIN_NAME`. The value is used only on a new, uninitialized installation; existing users are unchanged. An initialized installation with no users requires an administrator recovery process and will not silently recreate the bootstrap account. The previous bundled administrator identity is no longer created in new installations. Configure the corresponding sign-in provider and approved domain separately.
3. Set the company profile, logo and website in Settings. Confirm access roles and permissions with test accounts, and verify that other customers' identities cannot access this installation.
4. Configure Calendar, email, AI and scheduler using the customer's own authorized connection details. Each service is optional until enabled. Treat credentials as server-only secrets; never include them in browser configuration, documentation or support messages. The existing configuration is installation-wide, not self-service connection management.
5. Verify backups, restore, candidate data access, retention and deletion workflows, application security, monitoring and deployment configuration before going live. Separate infrastructure is an operational isolation requirement, not a substitute for security testing.

## Capability status

- **Google Calendar:** Existing integration uses installation-wide service account and Google Workspace delegated user configuration. It is not customer self-service OAuth. Test event creation, changes and cancellation against a test calendar.
- **Interview reminders:** Existing review-first email workflow requires a configured email provider and scheduler; no automatic delivery is promised.
- **Careers:** `/careers` lists only individually published, open requisitions for the assigned recruiter. New submissions through its dedicated links are recorded as Career Page; old submissions are not reclassified. Linking or embedding the page on the customer's existing site and choosing domains are separate work. A deployment or a customer listing action makes the chosen job publicly visible.
- **WhatsApp:** Not connected. Providers, account onboarding, consent, templates, delivery webhooks and per-installation credentials need implementation and testing.
- **LinkedIn and Naukri:** Not connected. Both depend on available partner access, permissions and APIs. Do not use a single customer's account or credentials for another customer.
- **Integration requests:** Admins can record interest in WhatsApp, Naukri and LinkedIn under Settings → Integrations. WhatsApp is an optional paid add-on with pricing agreed separately. These requests are stored in the customer's installation and audited; they do not notify STARSHIP, enable a service, store credentials, or initiate billing. Secure customer credential entry, provider connections, consent, commercial agreements and billing still require implementation.
- **AI screening:** An evidence summary exists. Recruiters remain responsible for decisions; validate output, privacy, access and customer settings before use. No automated rejection or ranking is implemented.
- **Self-service scheduling:** Not implemented. Requires availability rules, time zones, single-use links, booking conflict protection and cancellation/rescheduling flows.
- **Communication history:** Candidate profiles show the current user's automation email activity only; they are not a complete cross-channel inbox or delivery history.
- **Offer and joining:** Existing features include approvals, offer-related candidate fields, joining status and date history; documents, acceptance and handoff require further product review.
- **Data management:** Duplicate warnings exist in resume intake. Consent, retention, export and deletion need an explicit implementation and policy review. Do not claim these are completed.
