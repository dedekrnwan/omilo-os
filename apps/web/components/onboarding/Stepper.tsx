/* 4-step stepper for onboarding v2.
   Steps: 1 Your AI · 2 Get to know you · 3 Check · 4 Your team
   `active` is the 1-based step number currently shown (0 = welcome, not shown in stepper). */

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
          <div key={s.n} className={`ob2-step${done ? " done" : now ? " now" : ""}`} role="listitem" aria-current={now ? "step" : undefined}>
            <span className="ob2-step-n">
              {done ? <i className="ri-check-line" style={{ fontSize: 11 }} /> : s.n}
            </span>
            {s.label}
            {i < STEPS.length - 1 && <span style={{ flex: 1, minWidth: 16 }} />}
          </div>
        );
      })}
    </div>
  );
}
