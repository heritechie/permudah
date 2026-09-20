const steps = ["Create", "Publish", "Sell", "Use in ChatGPT"];

export function WorkflowSteps() {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-3">
          <span className="rounded-full border border-zinc-200 bg-white px-5 py-2 text-sm font-medium text-zinc-700">
            {step}
          </span>
          {index < steps.length - 1 && (
            <>
              <span
                aria-hidden="true"
                className="hidden text-zinc-300 sm:block"
              >
                →
              </span>
              <span
                aria-hidden="true"
                className="rotate-90 text-zinc-300 sm:hidden"
              >
                →
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}