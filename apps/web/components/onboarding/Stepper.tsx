/* 4-step stepper for onboarding v2 — rendered INSIDE the TopBar center slot.
   Steps: 1 Your AI · 2 Get to know you · 3 Check · 4 Your team
   `active` is the 1-based step number currently shown (0 = welcome, stepper hidden). */

import { Fragment } from "react";

const STEPS = [
  { n: 1, label: "Your AI" },
  { n: 2, label: "Get to know you" },
  { n: 3, label: "Check" },
  { n: 4, label: "Your team" },
];

export default function Stepper({ active }: { active: number }) {
  return (
    <div className="ob2-stepper" role="list" aria-label="Setup steps">
      {STEPS.map((s, i) => {
        const done = s.n < active;
        const now = s.n === active;
        return (
          <Fragment key={s.n}>
            {i > 0 && (
              <span className="ob2-step-conn" aria-hidden="true" />
            )}
            <div
              className={`ob2-step${done ? " done" : now ? " now" : ""}`}
              role="listitem"
              aria-current={now ? "step" : undefined}
            >
              <span className="ob2-step-n">
                {done ? <i className="ri-check-line" style={{ fontSize: 11 }} /> : s.n}
              </span>
              {s.label}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
