import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveDashboardGate } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import {
  getWorkflowsForCreator,
  workflowDateLabel,
  workflowStatusLabel,
} from "@/lib/workflows";

export const metadata: Metadata = {
  title: "Dashboard — Permudah",
};

export default async function DashboardPage() {
  const gate = await resolveDashboardGate();
  if (gate.kind === "login") redirect("/login");
  if (gate.kind === "onboarding") redirect("/onboarding/creator");

  const supabase = await createClient();
  const workflows = await getWorkflowsForCreator(supabase, gate.creator.id);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              My Workflows
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{gate.creator.display_name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/google"
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Build a Web App
            </Link>
            <Link
              href="/dashboard/workflows/new"
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              + Create Workflow
            </Link>
          </div>
        </header>

        {workflows.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-zinc-500">No workflows yet.</p>
            <p className="mt-1 text-sm text-zinc-400">
              Create your first workflow to publish it on your storefront.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {workflows.map((workflow) => (
              <li key={workflow.id}>
                <Link
                  href={`/dashboard/workflows/${workflow.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 transition hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{workflow.name}</span>
                  <span className="flex items-center gap-3 text-sm">
                    <span
                      className={
                        workflow.status === "published"
                          ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                          : "rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                      }
                    >
                      {workflowStatusLabel(workflow.status)}
                    </span>
                    <time className="text-zinc-400">
                      {workflowDateLabel(workflow.updated_at)}
                    </time>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}