import Image from "next/image";

export function StorefrontPlaceholder({ name }: { name: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
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
      <p className="mt-3 text-lg text-zinc-500">Coming soon.</p>
    </main>
  );
}