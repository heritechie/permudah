import Link from "next/link";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-7 sm:py-9">
      <Link href="/" className="text-lg font-semibold tracking-tight text-zinc-900">
        Permudah
      </Link>
      <a
        href="#early-access"
        className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
      >
        Early Access
      </a>
    </header>
  );
}