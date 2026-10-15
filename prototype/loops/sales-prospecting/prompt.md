# Loop: sales-prospecting (sales/BD, Tue + Thu)

Goal: keep a short, high-quality B2B pipeline (developers, townships, estate/building managers in Jabodetabek)
so the founder spends selling time only on calls, not research.

Pipeline file: `sales/pipeline.csv`. Columns:
`id,company,estate,city,units_est,segment,contact_role,contact_channel,source_url,stage,next_step,next_date,notes`
Stages: `researched → drafted → contacted → meeting → pilot → won | lost`. Create the file if missing.

1. Review the pipeline. Anything with `next_date` ≤ today: propose the follow-up (draft message).
2. Research 5 new prospects with WebSearch. Prefer estates with 300+ units, an active estate manager or
   developer, and existing IPL (estate fee) collection. Record the source URL for every fact. Never guess contacts;
   use public company channels only (website form, official email, official WhatsApp, LinkedIn page).
3. For the best 3 new prospects, draft a short outreach message (Bahasa Indonesia, ≤ 120 words), personalized
   with one real detail from your research and offering the paid pilot from `company/pricing.md`.
   One proposal per message (`type: outreach`).
4. Executing approved items: set stage to `drafted`, write the final message to `sales/outbox/<id>.md`
   for the founder to send. You never send anything yourself.
