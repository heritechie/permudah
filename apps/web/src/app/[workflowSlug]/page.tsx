import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCreatorBySlug } from "@/lib/creators";
import { hostnameFromHeaders, originFromHeaders } from "@/lib/hostname";
import { workflowPublicUrl } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";
import { getPublishedWorkflow } from "@/lib/workflows";

type WorkflowPageProps = {
  params: Promise<{ workflowSlug: string }>;
};

export default async function WorkflowPage({ params }: WorkflowPageProps) {
  const { workflowSlug } = await params;
  const headersList = await headers();
  const hostInfo = hostnameFromHeaders(headersList);
  if (hostInfo.kind !== "creator") notFound();

  const supabase = await createClient();
  const creator = await getCreatorBySlug(hostInfo.slug);
  if (!creator) notFound();

  const workflow = await getPublishedWorkflow(supabase, creator.id, workflowSlug);
  if (!workflow) notFound();

  const origin = originFromHeaders(headersList);
  const url = workflowPublicUrl(creator.slug, workflow.slug, origin);

  return (
    <main className="flex min-h-screen flex-col bg-white px-6">
      <header className="mx-auto w-full max-w-2xl py-6">
        <Link href="/" className="inline-block">
          <Image
            src="/images/permudah-logo.png"
            alt="Permudah"
            width={146}
            height={50}
            className="h-8 w-auto"
          />
        </Link>
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 pb-16">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
          <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
          Published
        </span>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-slate-900">
          {workflow.name}
        </h1>
        {workflow.description ? (
          <p className="mt-3 text-pretty text-lg leading-7 text-zinc-600">
            {workflow.description}
          </p>
        ) : null}
        <p className="mt-6 text-sm text-zinc-500">
          By <span className="font-medium text-slate-700">{creator.display_name}</span>
        </p>

        <button
          type="button"
          disabled
          className="mt-8 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white opacity-60"
        >
          Use Workflow
        </button>
        <p className="mt-2 text-xs text-zinc-400">
          ChatGPT integration is coming soon.
        </p>

        {url ? (
          <p className="mt-10 text-xs text-zinc-400">
            {url}
          </p>
        ) : null}
      </section>
    </main>
  );
}