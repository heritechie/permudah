import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import {
  getDictionary,
  localeCookieName,
  resolveLocale,
} from "@/i18n/dictionary";
import { hostnameFromHeaders } from "@/lib/hostname";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const [cookieStore, headersList] = await Promise.all([cookies(), headers()]);
  const dictionary = getDictionary(
    resolveLocale(
      cookieStore.get(localeCookieName)?.value,
      headersList.get("accept-language"),
    ),
  );
  const hostInfo = hostnameFromHeaders(headersList);
  const creatorTitle =
    hostInfo.kind === "creator" ? `${hostInfo.displayName} — Permudah` : null;
  return {
    title: creatorTitle ?? dictionary.meta.title,
    description: dictionary.meta.description,
    icons: {
      icon: "/images/permudah-app-icon-512.png",
      apple: "/images/permudah-app-icon-512.png",
    },
    openGraph: {
      title: dictionary.meta.title,
      description: dictionary.meta.description,
      images: ["/images/permudah-og-image.png"],
    },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [cookieStore, headersList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(localeCookieName)?.value,
    headersList.get("accept-language"),
  );

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}