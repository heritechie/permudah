import { cookies, headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  localeCookieName,
  resolveLocale,
} from "@/i18n/dictionary";

export async function Header() {
  const [cookieStore, headersList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(localeCookieName)?.value,
    headersList.get("accept-language"),
  );

  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 sm:py-8">
      <Link href="/" aria-label="Permudah home">
        <Image
          src="/images/permudah-logo.png"
          alt="Permudah"
          width={146}
          height={50}
          priority
          sizes="(min-width: 640px) 146px, 130px"
          className="h-11 w-auto sm:h-[50px]"
        />
      </Link>
      <div className="flex items-center gap-5 sm:gap-7">
        <a
          href="#early-access"
          className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          Early Access
        </a>
        <LanguageSwitcher locale={locale} />
      </div>
    </header>
  );
}