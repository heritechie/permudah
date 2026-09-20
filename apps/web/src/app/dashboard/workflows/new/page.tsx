import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WorkflowForm } from "@/components/workflow-form";
import { resolveDashboardGate } from "@/lib/dashboard";
import { originFromHeaders } from "@/lib/hostname";

export const metadata: Metadata = {
  title: "New Workflow — Permudah",
};

export default async function NewWorkflowPage() {
  const gate = await resolveDashboardGate();
  if (gate.kind === "login") redirect("/login");
  if (gate.kind === "onboarding") redirect("/onboarding/creator");

  const origin = originFromHeaders(await headers());

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          New Workflow
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Save as a draft, then publish it to your storefront.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <WorkflowForm mode="create" creatorSlug={gate.creator.slug} origin={origin} />
        </div>
      </div>
    </main>
  );
}