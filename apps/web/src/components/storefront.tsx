import Image from "next/image";
import Link from "next/link";
import { getPublishedWorkflowsForCreator } from "@/lib/workflows";
import { createClient } from "@/lib/supabase/server";
import type { StorefrontCreator } from "@/lib/creators";

type StorefrontProps = {
  creator: StorefrontCreator | null;
  displayName: string;
};

export async function Storefront({ creator, displayName }: StorefrontProps) {
  const name = creator?.display_name ?? displayName;
  const bio = creator?.bio ?? null;
  const supabase = await createClient();
  const workflows = creator
    ? await getPublishedWorkflowsForCreator(supabase, creator.id)
    : [];

  return (
    <main className="flex min-h-screen flex-col bg-white px-6">
      <header className="mx-auto w-full max-w-2xl py-6">
        <Image
          src="/images/permudah-logo.png"
          alt="Permudah"
          width={146}
          height={50}
          className="h-8 w-auto"
        />
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 pb-16">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {name}
        </h1>
        {bio ? <p className="mt-3 text-pretty text-lg leading-7 text-zinc-600">{bio}</p> : null}

        {!creator ? (
          <p className="mt-8 text-sm text-zinc-500">Coming soon</p>
        ) : (
          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
              Workflows
            </h2>
            {workflows.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">No workflows published yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {workflows.map((workflow) => (
                  <li key={workflow.id}>
                    <Link
                      href={`/${workflow.slug}`}
                      className="block rounded-lg px-3 py-4 transition hover:bg-slate-50"
                    >
                      <h3 className="font-medium text-slate-900">{workflow.name}</h3>
                      {workflow.description ? (
                        <p className="mt-1 text-sm text-zinc-600">
                          {workflow.description}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </section>
    </main>
  );
}