"use client";
import { useSearchParams } from "next/navigation";
import { Markdown } from "@/components/Markdown";

/* ------------------------------------------------------------------ static content */

const GUIDES: Record<string, { title: string; category: string; md: string }> = {
  "how-inbox-works": {
    title: "How the Inbox works",
    category: "Inbox & Approvals",
    md: `# How the Inbox works

The Inbox is where you make decisions. When a helper needs something from you — approval for a job, a reply to a question, or a choice between options — it lands here.

## What you'll see

Each card shows which helper is asking, what it wants to do, and any proposals it has drafted. Cards are grouped so related decisions appear together.

## Statuses

- **Needs you** — waiting for your input before anything runs.
- **Running** — approved and in progress.
- **Done** — completed; you can review the result.

## Tips

- Use **Approve all** when a helper proposes several steps you trust — they all start at once.
- Use **Reply** instead of approving if you want to redirect or add context.
- You can undo an approval within a short window, before the helper acts on it.
`,
  },
  "approve-many": {
    title: "Approve many jobs at once",
    category: "Inbox & Approvals",
    md: `# Approve many jobs at once

When several helpers propose work at the same time, you don't have to approve them one by one.

## Steps

1. **Open Inbox.** Proposals that belong together show up as one card.
2. **Read the list.** Each row is one helper and what it wants to do.
3. **Choose Approve all.** Nothing runs until you do, and each helper starts on its own schedule.

## What happens next

Each helper confirms in its own chat and starts on its schedule. You'll see them move to **Running** in the Inbox.

> **Tip:** If one proposal looks wrong, approve the others and reply separately to the one you want to adjust.
`,
  },
  "reply-instead-of-approving": {
    title: "Reply instead of approving",
    category: "Inbox & Approvals",
    md: `# Reply instead of approving

Sometimes you don't want to say yes or no — you want to change the plan. Type your reply in the card's composer and the helper will revise its proposal.

## When to use this

- The helper misunderstood the goal.
- You want to adjust the scope, deadline, or approach.
- You need more information before deciding.

## How it works

Your reply goes directly to the helper's chat. It reads your message and comes back with a revised proposal, which appears as a new card in Inbox.
`,
  },
  "approve-by-email": {
    title: "Approve by email",
    category: "Inbox & Approvals",
    md: `# Approve by email

If your company has SMTP configured, helpers can send approval requests to your email. You reply directly to approve or reject — no need to open Omilo.

## Requirements

- A company SMTP configuration (Settings → Email → SMTP).
- The **Email notifications** channel enabled in Settings → Notifications.

## How to approve

Reply to the notification email with **yes**, **approve**, or **ok** (case-insensitive) to approve the job. Reply with **no**, **reject**, or **stop** to reject it. The helper acts immediately.

## Security

Only replies from your registered email address are accepted. If the reply comes from a different address, the helper ignores it and keeps the job in Inbox.
`,
  },
  "helpers-and-jobs": {
    title: "Helpers & jobs",
    category: "Helpers & Jobs",
    md: `# Helpers & jobs

A **helper** is a configured AI agent with a role, instructions, tools, and a schedule. A **job** is a single run — one helper doing one thing.

## Hiring a helper

Go to **Staff → Hire a helper** (or the Talent library) to browse available roles. Each helper comes with a default instruction set you can customise.

## Running a job

Most helpers run on a schedule you set at hire time. You can also trigger a run manually from the helper's chat or from the Work list.

## Monitoring jobs

Open **Work** to see every job: running, done, and failed. Click a job to see its steps, sources, and what it produced.
`,
  },
  "workflows": {
    title: "Workflows",
    category: "Workflows",
    md: `# Workflows

Workflows chain helpers together: one helper's output becomes another's input. Use them when a task is too large or specialised for a single helper.

## Creating a workflow

Go to **Workflows → New workflow**. Add steps, connect the output of each step to the input of the next, and set the trigger (schedule or manual).

## Tips

- Keep each helper's step focused on one thing.
- Add a review step (a helper that summarises the chain's output) at the end.
- Use the Inbox to approve each step if you want human oversight in the middle of the chain.
`,
  },
  "connectors": {
    title: "Connectors",
    category: "Connectors",
    md: `# Connectors

Connectors give helpers access to external services — Google Drive, Slack, email, databases, and more.

## Adding a connector

Go to **Settings → Connectors** and click **Add**. Choose the service, authenticate, and grant the permissions the helper needs.

## Permissions

Each connector shows which helpers use it and what they can read or write. You can revoke access at any time without deleting the connector.

## Troubleshooting

If a helper says it can't reach a service, check that its connector is still authenticated. Token expiry is the most common cause — re-authorise and the helper will retry.
`,
  },
  "personas": {
    title: "Personas",
    category: "Personas",
    md: `# Personas

A **persona** captures your own experience, style, and judgment so other teams can hire a helper that thinks like you.

## Creating your persona

Go to **You → Your Persona** (coming soon) or **Staff → Persona Studio** (coming soon) to build one. You describe your expertise, preferred approach, and any rules you want the persona to follow.

## Hiring a persona

Once published, your persona appears in the Talent library. Other companies can hire it just like any other helper.

## Privacy

Personas do not share personal data, credentials, or company-specific information. They capture your decision-making style, not your company's data.
`,
  },
  "ai-accounts": {
    title: "AI accounts & spend",
    category: "AI Accounts & Spend",
    md: `# AI accounts & spend

Omilo uses AI models to power your helpers. You connect your own AI provider account so you control spend and model choice.

## Connecting an account

Go to **Settings → AI accounts** and add your Anthropic (Claude) API key. Omilo uses it for all model calls on your company.

## Monitoring spend

Each job records token usage. Open **Work → a job → Steps** to see exactly what was sent to the model and how many tokens it used.

## Controlling costs

- Set a monthly budget alert in **Settings → AI accounts**.
- Use **Pause all helpers** in the sidebar to stop all new runs immediately.
- Cheaper models run faster for simple tasks; configure per-helper in the helper's settings.
`,
  },
};

const HELP_MD = `# Help & guides

Welcome to Omilo help. Find answers below or search guides to get the most from your AI helpers.

## Getting started

- [How the Inbox works](?a=how-inbox-works) — understand decisions, statuses, and what helpers need from you.
- [Helpers & jobs](?a=helpers-and-jobs) — hire your first helper and monitor its runs.
- [Connectors](?a=connectors) — connect Google Drive, Slack, email, and other services.

## Inbox & Approvals

- [How the Inbox works](?a=how-inbox-works)
- [Approve many jobs at once](?a=approve-many)
- [Reply instead of approving](?a=reply-instead-of-approving)
- [Approve by email](?a=approve-by-email)

## Helpers & Jobs

- [Helpers & jobs](?a=helpers-and-jobs)

## Workflows

- [Workflows](?a=workflows)

## Connectors

- [Connectors](?a=connectors)

## Personas

- [Personas](?a=personas)

## AI Accounts & Spend

- [AI accounts & spend](?a=ai-accounts)

---

*Can't find what you need? Use the Chief of Staff bar (⌘K) to ask a question in plain language.*
`;

/* ------------------------------------------------------------------ page */

export default function HelpPage() {
  const params = useSearchParams();
  const slug = params?.get("a") || null;
  const article = slug ? GUIDES[slug] : null;

  if (article) {
    return (
      <div className="help-page">
        <div className="help-nav">
          <a href="/help/" className="btn quiet sm"><i className="ri-arrow-left-line" />All guides</a>
          <span className="help-cat">{article.category}</span>
        </div>
        <Markdown text={article.md} />
      </div>
    );
  }

  return (
    <div className="help-page">
      <Markdown text={HELP_MD} />
    </div>
  );
}
