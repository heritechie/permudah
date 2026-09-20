import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CreatorOnboardingForm } from "@/components/creator-onboarding-form";
import { getCreatorByUserId } from "@/lib/creators";
import { creatorStorefrontUrl } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up your storefront — Permudah",
};

export default async function CreatorOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const creator = await getCreatorByUserId(user.id);
  if (creator) {
    redirect(creatorStorefrontUrl(creator.slug));
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Image
            src="/images/permudah-logo.png"
            alt="Permudah"
            width={146}
            height={50}
            className="h-10 w-auto"
          />
        </div>
        <h1 className="mt-8 text-center text-2xl font-semibold tracking-tight text-slate-900">
          Set up your storefront
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          Choose the name and address where customers will find your AI workflows.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <CreatorOnboardingForm />
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500">
          <a href="https://permudah.com" className="font-medium text-blue-600 hover:text-blue-700">
            Back to Permudah
          </a>
        </p>
      </div>
    </main>
  );
}