import Image from "next/image";

type StorefrontPlaceholderProps = {
  name: string;
  bio?: string | null;
  registered?: boolean;
};

export function StorefrontPlaceholder({
  name,
  bio,
  registered = false,
}: StorefrontPlaceholderProps) {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16 text-center">
      <Image
        src="/images/permudah-logo.png"
        alt="Permudah"
        width={146}
        height={50}
        className="h-10 w-auto sm:h-12"
      />
      <h1 className="mt-10 text-balance text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
        {name}
      </h1>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-blue-600">
        Creator storefront
      </p>

      {registered ? (
        <>
          {bio ? (
            <p className="mt-4 max-w-xl text-pretty text-lg text-zinc-600">
              {bio}
            </p>
          ) : null}
          <div className="mt-10 w-full max-w-xl rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8">
            <p className="text-sm font-medium text-slate-700">Workflows</p>
            <p className="mt-1 text-sm text-zinc-500">
              No workflows published yet.
            </p>
          </div>
        </>
      ) : (
        <p className="mt-3 text-lg text-zinc-500">Coming soon.</p>
      )}
    </main>
  );
}