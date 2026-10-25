/**
 * Onboarding 6 · Team ready — the first Inbox (pen FZ9LR).
 * The real app frame (Rail · Office sidebar · Inset) with the team's first jobs.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarSync,
  ChartLine,
  Check,
  Circle,
  CircleCheck,
  FileText,
  Inbox,
  Layers,
  ListFilter,
  MessageCircle,
  Target,
  Workflow,
} from "lucide-react";
import { useUIStore } from "../../app/store";
import { Rail } from "../../ui/Rail";
import { Button } from "../../ui/ds/Button";
import { Inset, Topbar } from "../../ui/ds/Frame";
import { Mascot } from "../../ui/ds/Mascot";
import {
  GroupLabel,
  NavGroup,
  NavLink,
  SidebarFrame,
} from "../../ui/ds/Sidebar";
import {
  COMPANY_NAME,
  GETTING_STARTED_ITEMS,
  INBOX_AREAS,
  INBOX_JOBS,
} from "./data";
import type { InboxJob } from "./data";
import { Stroke } from "./parts";

function Sidebar() {
  return (
    <SidebarFrame label="Office">
      <div className="flex w-full items-center gap-[8px] px-[8px] py-[6px]">
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[13.5px] font-semibold text-ink">
            {COMPANY_NAME}
          </span>
          <span className="truncate text-[11.5px] text-muted">
            Office · 5 areas
          </span>
        </div>
      </div>
      <NavGroup>
        <NavLink icon={Target} label="Goals" />
        <NavLink
          icon={Inbox}
          label="Inbox"
          active
          count={5}
          countClassName="font-semibold text-[#EB6834]"
        />
        <NavLink icon={Workflow} label="Flows" />
        <NavLink icon={CalendarSync} label="Routines" />
        <NavLink icon={FileText} label="Docs" />
        <NavLink icon={ChartLine} label="Analytics" />
      </NavGroup>
      <NavGroup>
        <GroupLabel label="AREAS" />
        <NavLink
          icon={Layers}
          label="All areas"
          count={14}
          labelClassName="text-ink-2"
          active
        />
        {INBOX_AREAS.map((a) => (
          <NavLink
            key={a.label}
            label={a.label}
            count={a.count}
            labelClassName="text-ink-2"
            leading={
              <span
                aria-hidden
                className="flex size-[16px] shrink-0 items-center justify-center"
              >
                <span
                  className="size-[8px] rounded-full"
                  style={{ background: a.color }}
                />
              </span>
            }
          />
        ))}
      </NavGroup>
    </SidebarFrame>
  );
}

function JobCard({
  job,
  approved,
  onApprove,
}: {
  job: InboxJob;
  approved: boolean;
  onApprove: () => void;
}) {
  return (
    <article className="relative flex w-full items-center gap-[12px] rounded-lg bg-surface px-[16px] py-[15px]">
      <Mascot helper area={job.area} size={28} radius={8} title={job.helper} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <p className="flex items-center gap-[6px] text-[12px] text-muted">
          <span>{job.helper}</span>
          <span>·</span>
          <span className="font-mono text-[11.5px]">{job.cost}</span>
        </p>
        <h3 className="text-[14px] font-semibold text-ink">{job.title}</h3>
        <p className="text-[12px] text-ink-2">{job.desc}</p>
      </div>
      {approved ? (
        <span className="flex items-center gap-[6px] text-[13px] font-medium text-ok">
          <CircleCheck size={15} aria-hidden />
          Approved
        </span>
      ) : (
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            className="h-[32px] px-[14px] text-[14px] text-muted hover:text-ink"
          >
            Not now
          </button>
          <button
            type="button"
            className="h-[32px] rounded-btn bg-surface px-[14px] text-[14px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="h-[32px] rounded-btn bg-primary px-[14px] text-[14px] font-medium text-primary-ink hover:bg-primary-hover"
          >
            Approve
          </button>
        </div>
      )}
      <Stroke />
    </article>
  );
}

function GettingStarted() {
  const done = GETTING_STARTED_ITEMS.filter((i) => i.done).length;
  return (
    <section
      aria-label="Getting started"
      className="relative flex w-full flex-col gap-[12px] rounded-lg bg-surface p-[16px]"
    >
      <div className="flex w-full items-center">
        <h2 className="flex-1 text-[14px] font-semibold text-ink">
          Getting started
        </h2>
        <span className="font-mono text-[11.5px] text-muted">
          {done} of {GETTING_STARTED_ITEMS.length}
        </span>
      </div>
      <div className="relative h-[4px] w-full overflow-hidden rounded-pill bg-line-strong">
        <span
          className="absolute inset-y-0 left-0 rounded-pill bg-ok"
          style={{ width: `${(done / GETTING_STARTED_ITEMS.length) * 100}%` }}
        />
      </div>
      <ul className="-mt-[5px] -mb-[6px] flex w-full flex-col">
        {GETTING_STARTED_ITEMS.map((i) => (
          <li key={i.id} className="flex h-[28px] items-center gap-[10px]">
            {i.done ? (
              <CircleCheck size={14} aria-label="done" className="text-ok" />
            ) : (
              <Circle size={14} aria-hidden className="text-faint" />
            )}
            <span
              className={`text-[13px] ${i.done ? "text-muted" : "text-ink"}`}
            >
              {i.label}
            </span>
          </li>
        ))}
      </ul>
      <Stroke />
    </section>
  );
}

export function StepInbox() {
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const left = INBOX_JOBS.filter((j) => !approved[j.id]).length;
  const navigate = useNavigate();

  useEffect(() => {
    // The first Inbox is the Office: the rail's mode switch should show it.
    useUIStore.getState().setMode("office");
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full">
      <Rail />
      <Sidebar />
      <Inset label="Inbox">
        <Topbar
          icon={Inbox}
          title="Inbox"
          meta={`${left} need you`}
          actions={
            <Button variant="secondary" height={28} icon={ListFilter}>
              All areas
            </Button>
          }
        />
        <div className="flex min-h-0 w-full flex-1 flex-col gap-[16px] overflow-y-auto px-[24px] pt-[20px] pb-[24px]">
          <div className="flex flex-col gap-[4px]">
            <h1 className="font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
              Inbox
            </h1>
            <p className="text-[13px] text-muted">
              Your team just joined. Approve their first jobs and they start
              working.
            </p>
          </div>
          <div className="flex w-full items-start gap-[20px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[16px]">
              <section
                aria-label="Your team is ready"
                className="relative flex w-full items-center gap-[16px] rounded-lg bg-[#EEF2FF] px-[20px] pt-[19px] pb-[18px]"
              >
                <div className="flex items-end">
                  <Mascot
                    helper
                    area="brand"
                    size={44}
                    radius={12}
                    title="Chief of Staff"
                  />
                  <Mascot
                    helper
                    area="dev"
                    size={40}
                    radius={11}
                    title="Builder"
                    className="-ml-[3px]"
                  />
                  <Mascot
                    helper
                    area="ops"
                    size={40}
                    radius={11}
                    title="Grower"
                    className="-ml-[8px]"
                  />
                  <Mascot
                    helper
                    area="support"
                    size={40}
                    radius={11}
                    title="Support"
                    className="-ml-[8px]"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                  <h2 className="font-display text-[20px] font-semibold tracking-[-0.4px] text-ink">
                    Your team is ready, Dede
                  </h2>
                  <p className="w-full text-[13px] leading-[1.5] text-ink-2">
                    Chief, Builder, Grower and Support each proposed a first job
                    based on what you told me. Nothing runs until you approve.
                  </p>
                </div>
                <Stroke color="#C7D2FE" />
              </section>

              <div className="flex w-full items-center gap-[8px]">
                <h2 className="text-[14px] font-semibold text-ink">
                  First jobs to approve
                </h2>
                <span className="flex size-[20px] items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-ink">
                  {left}
                </span>
                <span className="h-px flex-1" />
                {left > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setApproved(
                        Object.fromEntries(INBOX_JOBS.map((j) => [j.id, true])),
                      );
                      navigate({ to: '/office/inbox' });
                    }}
                    className="flex h-[32px] items-center gap-[6px] rounded-btn bg-primary px-[14px] text-[14px] font-medium text-primary-ink hover:bg-primary-hover"
                  >
                    <Check size={16} aria-hidden />
                    Approve all {left}
                  </button>
                )}
              </div>

              <div className="flex w-full flex-col gap-[16px]">
                {INBOX_JOBS.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    approved={!!approved[j.id]}
                    onApprove={() =>
                      setApproved((a) => ({ ...a, [j.id]: true }))
                    }
                  />
                ))}
              </div>
            </div>

            <aside className="flex w-[320px] shrink-0 flex-col gap-[12px]">
              <GettingStarted />
              <div className="relative flex w-full gap-[10px] rounded-lg bg-soft px-[14px] py-[12px]">
                <MessageCircle
                  size={16}
                  aria-hidden
                  className="mt-[2px] shrink-0 text-ink-2"
                />
                <p className="min-w-0 flex-1 text-[14px] leading-[1.45] text-ink-2">
                  Not sure? Ask Chief anything with ⌘J. It knows what your team
                  is doing.
                </p>
                <Stroke />
              </div>
            </aside>
          </div>
        </div>
      </Inset>
    </div>
  );
}
