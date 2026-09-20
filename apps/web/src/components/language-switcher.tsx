"use client";

import type { Locale } from "@/i18n/dictionary";
import { localeCookieName } from "@/i18n/dictionary";

const options: Locale[] = ["en", "id"];

function applyLocale(next: Locale) {
  document.cookie = `${localeCookieName}=${next}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  return (
    <div className="flex items-center gap-1 text-xs font-semibold">
      {options.map((option, index) => (
        <div key={option} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => applyLocale(option)}
            aria-pressed={locale === option}
            className={`rounded-md px-1.5 py-1 transition-colors ${
              locale === option
                ? "bg-blue-50 text-blue-700"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {option.toUpperCase()}
          </button>
          {index < options.length - 1 && (
            <span aria-hidden="true" className="text-zinc-300">
              /
            </span>
          )}
        </div>
      ))}
    </div>
  );
}