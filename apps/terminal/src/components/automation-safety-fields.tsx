import type { AutomationFormState } from "@/lib/automation-form-state";
import { automationPolicyInput } from "@/utils/automation-policy-input";
import { FORM_SECTION_CARD_CLASSES } from "@/lib/automation-form-styles";

interface Props {
  form: AutomationFormState;
  onChange: (next: AutomationFormState) => void;
}
const overlapOptions = [
  {
    value: "skip",
    title: "Skip the new run",
    description: "Keep the current run. Do not save extra work for later.",
  },
  {
    value: "queue-latest",
    title: "Wait, then run the latest",
    description: "Keep one waiting run. New triggers replace older waiting work.",
  },
  {
    value: "allow",
    title: "Run alongside it",
    description: "Start another run immediately. Work may overlap and use more resources.",
  },
] as const;
const missedOptions = [
  {
    value: "skip",
    title: "Wait for the next scheduled time",
    description: "Do not catch up on runs missed while the server was unavailable.",
  },
  {
    value: "run-latest",
    title: "Catch up once",
    description:
      "Run only the latest missed occurrence when the server returns, subject to safety settings and limits.",
  },
] as const;

export const AutomationSafetyFields = ({ form, onChange }: Props) => {
  const thread = form.runner.runnerType === "agent" && form.runner.agentSessionMode === "thread";
  const policy = automationPolicyInput(form);
  return (
    <section className={FORM_SECTION_CARD_CLASSES}>
      {form.triggerType === "watch" || form.triggerType === "event" ? (
        <p className="text-[11px] text-muted-foreground">
          Automatic file and session-event triggers are suppressed during active work to prevent
          feedback loops. These busy-run choices still apply to Run now.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium">If a run is still busy</legend>
        {overlapOptions.map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-2 rounded-md border border-border/50 p-2 text-xs ${thread && option.value === "allow" ? "opacity-50" : "cursor-pointer hover:bg-foreground/5"}`}
          >
            <input
              className="mt-0.5 accent-current"
              type="radio"
              name="automation-overlap"
              value={option.value}
              checked={policy.concurrencyPolicy === option.value}
              disabled={thread && option.value === "allow"}
              onChange={() => onChange({ ...form, concurrencyPolicy: option.value })}
            />
            <span>
              <span className="block font-medium">{option.title}</span>
              <span className="text-[11px] text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
        {thread ? (
          <p className="text-[11px] text-muted-foreground">
            Thread agents run one at a time to protect shared context. Older “run alongside”
            settings become “wait, then run the latest” when saved.
          </p>
        ) : null}
      </fieldset>
      {form.triggerType === "schedule" ? (
        <fieldset className="mt-2 flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium">
            If the server misses a scheduled time
          </legend>
          {missedOptions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border/50 p-2 text-xs hover:bg-foreground/5"
            >
              <input
                className="mt-0.5 accent-current"
                type="radio"
                name="automation-missed"
                value={option.value}
                checked={policy.missedRunPolicy === option.value}
                onChange={() => onChange({ ...form, missedRunPolicy: option.value })}
              />
              <span>
                <span className="block font-medium">{option.title}</span>
                <span className="text-[11px] text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </section>
  );
};
