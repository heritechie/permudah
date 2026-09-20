import { cookies, headers } from "next/headers";
import Image from "next/image";
import { EarlyAccessForm } from "@/components/early-access-form";
import { Header } from "@/components/header";
import { ProductFlow } from "@/components/product-flow";
import { StorefrontPlaceholder } from "@/components/storefront-placeholder";
import {
  getDictionary,
  localeCookieName,
  resolveLocale,
} from "@/i18n/dictionary";
import { hostnameFromHeaders } from "@/lib/hostname";
import { getCreatorBySlug } from "@/lib/creators";

export default async function Home() {
  const [cookieStore, headersList] = await Promise.all([cookies(), headers()]);
  const hostInfo = hostnameFromHeaders(headersList);

  if (hostInfo.kind === "creator") {
    const creator = await getCreatorBySlug(hostInfo.slug);
    return (
      <StorefrontPlaceholder
        name={creator?.display_name ?? hostInfo.displayName}
        bio={creator?.bio ?? null}
        registered={Boolean(creator)}
      />
    );
  }

  const hero = getDictionary(
    resolveLocale(
      cookieStore.get(localeCookieName)?.value,
      headersList.get("accept-language"),
    ),
  ).hero;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />

      <main className="flex flex-1 flex-col items-center px-6">
        <section
          id="early-access"
          className="grid w-full max-w-5xl scroll-mt-10 items-center gap-12 pb-8 pt-12 sm:pb-10 sm:pt-16 lg:grid-cols-[9fr_11fr] lg:gap-14"
        >
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-600">
              {hero.eyebrow}
            </p>
            <h1 className="mt-4 text-balance text-[2.5rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[3.4rem] lg:text-[4.25rem]">
              {hero.headline}
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-8 text-zinc-600 sm:text-xl sm:leading-9">
              {hero.subheadline}
            </p>

            <div className="mt-8 flex w-full flex-col items-center gap-3 lg:items-start">
              <EarlyAccessForm ui={hero} />
              <p className="mt-2 text-sm text-zinc-500">
                {hero.supportingText}
              </p>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <Image
              src="/images/permudah-hero-workflow.png"
              alt="An AI workflow product built from creator expertise and used in ChatGPT"
              width={1536}
              height={1024}
              priority
              sizes="(min-width: 1024px) 560px, 100vw"
              className="h-auto w-full max-w-md shadow-sm lg:max-w-none"
            />
          </div>
        </section>

        <section className="w-full max-w-5xl pb-20 pt-8 sm:pt-10">
          <ProductFlow steps={hero.workflowSteps} />
        </section>
      </main>
    </div>
  );
}