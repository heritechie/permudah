import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { WorkflowForm } from "@/components/workflow-form";
import { resolveDashboardGate } from "@/lib/dashboard";
import { originFromHeaders } from "@/lib/hostname";
import { createClient } from "@/lib/supabase/server";
import {
  getWorkflowForCreator,
  inputFieldsFromDefinition,
  instructionsFromDefinition,
  workflowStatusLabel,
} from "@/lib/workflows";

export const metadata: Metadata = {
  title: "Edit Workflow — Permudah",
};

type EditWorkflowPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditWorkflowPage({ params }: EditWorkflowPageProps) {
  const { id } = await params;

  const gate = await resolveDashboardGate();
  if (gate.kind === "login") redirect("/login");
  if (gate.kind === "onboarding") redirect("/onboarding/creator");

  const supabase = await createClient();
  const result = await getWorkflowForCreator(supabase, id, gate.creator.id);
  if (!result.ok) notFound();

  const workflow = result.data;
  const instructions = instructionsFromDefinition(workflow.draft_definition);
  const inputFields = inputFieldsFromDefinition(workflow.draft_definition);
  const origin = originFromHeaders(await headers());

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Edit Workflow
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              <span className="font-medium text-slate-700">{workflow.name}</span>{" "}
              — {workflowStatusLabel(workflow.status)}
            </p>
          </div>
          <span
            className={
              workflow.status === "published"
                ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                : "rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
            }
          >
            {workflowStatusLabel(workflow.status)}
          </span>
        </header>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <WorkflowForm
            mode="edit"
            creatorSlug={gate.creator.slug}
            origin={origin}
            workflowId={workflow.id}
            workflowSlug={workflow.slug}
            status={workflow.status}
          initial={{
            name: workflow.name,
            description: workflow.description ?? "",
            instructions,
            inputFields,
          }}
          />
        </div>
      </div>
    </main>
  );
}