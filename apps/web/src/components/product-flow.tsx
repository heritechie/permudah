import Image from "next/image";
import type { WorkflowStep } from "@/i18n/dictionary";

export function ProductFlow({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="flex w-full flex-col items-center gap-8 sm:flex-row sm:items-stretch sm:gap-0">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className="flex w-full flex-col items-center sm:w-auto sm:flex-1 sm:flex-row"
        >
          <div className="flex w-full max-w-xs flex-col items-center gap-2.5 text-center sm:flex-1 sm:px-4">
            <Image
              src={step.icon}
              alt=""
              width={64}
              height={64}
              className="h-14 w-14 sm:h-16 sm:w-16"
            />
            <p className="text-sm font-semibold text-slate-900">{step.label}</p>
            <p className="text-sm leading-6 text-zinc-500">{step.description}</p>
          </div>
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="py-3 text-zinc-300 sm:py-0">
              <span className="rotate-90 text-lg leading-none sm:hidden">→</span>
              <span className="hidden text-lg leading-none sm:block">→</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}