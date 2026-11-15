# STARSHIP automations

See also: [Hiring integrations](hiring-integrations.md) and [Customer installations](customer-installations.md).

The workspace uses a charcoal/ivory theme. Admins and recruiters have an Automations page and an Ask STARSHIP panel. Interview scheduling is unchanged and remains manual.

## Connect services

Set server environment variables from `.env.example`, then restart the application:

- `OPENAI_API_KEY` and `OPENAI_MODEL`: a Responses API model enabled for your project. Profile fields, job requirements, and relevant feedback are sent to OpenAI only when AI is requested or an enabled AI workflow runs. API response storage is disabled. Review your organization's data-processing requirements before enabling it.
- `RESEND_API_KEY` and `AUTOMATION_FROM_EMAIL`: use a verified sender domain. Messages use the recruiter as the reply-to address. A successful send means the provider accepted the email, not verified inbox delivery.
- `CRON_SECRET`: a long random secret. Vercel's configured hourly cron calls `/api/automations/cron` using `Authorization: Bearer <CRON_SECRET>`. Ensure the hosting plan supports hourly cron and a 60-second function duration. On other hosts schedule the same authenticated GET endpoint. Setting the secret alone does not start a scheduler. The UI reports authorization configuration, not scheduler health.

No provider credentials are shipped to the browser. No live email or AI calls are needed for the unit tests.

## Enable workflows

Settings are per recruiter/admin account and saved in Firestore. All workflows start paused. Enable the ones you need, edit the message templates, and select automatic sending for routine feedback, approval, or joining reminders if desired. Otherwise all outgoing messages require review and **Approve & send**. Candidate stage messages always require review. Run enabled workflows manually to prepare items without waiting for cron.

- Feedback: one reminder per interview/time, directed only to panelists without feedback. One escalation to the recruiter's active manager, or the hiring manager if no active manager exists. Reminder/escalation timing is configurable. Rescheduled and cancelled interviews are revalidated.
- Interview reminders: prepare a separate reviewable email for each candidate and interviewer within the configured window before a scheduled interview. Changed, cancelled, completed or past interviews invalidate pending reminders. The hourly scheduler is best-effort; it does not guarantee an exact delivery time. Email must be configured and a recruiter must review and send each draft.
- Approvals: hiring requests to department heads; candidate review to the hiring manager; offer approval to department heads. One reminder per source version; this is not a repeated daily email campaign.
- Intake: when enabled, the first three resumes per upload batch receive AI enhancement. Remaining files use standard extraction. Provider failures fall back visibly to standard extraction. Review all profiles before saving. Duplicate warnings compare email/phone with records in the recruiter's permitted scope. Nothing is merged automatically.
- Candidate updates: only new supported stage changes after enabling. No replay of historical transitions. Rejections and offer decisions are excluded.
- Joining: reminders at the configured window and at two days before joining, for offered candidates awaiting confirmation or rescheduled, while the Offer & Joining add-on is enabled. These request a reply; inbound replies and document completion are not automatically processed. Mark confirmation in the existing joining screen to stop further messages.
- Interview briefs: up to three AI briefs per run, within the configured hours before already scheduled interviews. These summarize recorded profile fields and job requirements; they do not automatically open resume files. Briefs remain in the review queue. No scheduling is performed.

The daily brief, candidate evidence summaries, and bot use bounded, authorized snapshots (80 requests, 150 candidate profiles, 80 interviews and feedback records). Candidate searches are limited to these permitted records, including eligible profiles marked as talent pool records; they do not access other recruiters' data. Answers include supporting record IDs and make no hiring decisions. Each bot question is independent. AI requests share a per-user six-per-minute budget.

## Storage and reliability

Server-only Firestore collections: `automation_settings`, `automation_tasks`, `automation_locks`, `ai_rate_limits`; existing `audit_log` records configuration, send and review actions. Do not grant direct browser writes to these collections. Existing Firebase Admin credentials provide server access; no new browser permissions are required.

Business-event task IDs are stable across users and runs. Firestore create/transactions prevent duplicate work and concurrent sends. Send actions recheck current record state, recipients, scope and enabled settings. Pausing stops pending automatic sends; already submitted messages cannot be recalled. Existing drafts are still visible while paused and cannot be sent until re-enabled.

Messages use Resend idempotency keys. A failed, interrupted, or ambiguous delivery is not automatically retried; check the provider log and follow up manually to avoid duplicates. A stuck `sending` item requires provider-log review; do not reset it blindly. Brief generation interrupted by a runner timeout is marked failed on a later run. Runs are bounded and resume pending work on subsequent invocations; on large teams monitor the cron response's remaining count and last-run times. Global cron and per-user locks prevent overlapping runs.

## Verify

Run `npm test` (runs `scripts/test-automations.cjs`), `node node_modules/typescript/bin/tsc --noEmit --incremental false`, and the production build. In a connected test workspace verify paused defaults; role scoping; draft editing; reminders after thresholds; cancellation when feedback/approval/joining confirmation arrives; provider errors; duplicate manual/cron requests; and responsive layout. Never use real candidate recipients for delivery testing.

References: [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Resend send email](https://resend.com/docs/api-reference/emails/send-email).
