export const locales = ["en", "id"] as const;
export type Locale = (typeof locales)[number];

export const localeCookieName = "permudah_locale";

export type WorkflowStep = {
  label: string;
  description: string;
  icon: string;
};

export type Dictionary = {
  locale: Locale;
  meta: {
    title: string;
    description: string;
  };
  hero: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    emailLabel: string;
    emailPlaceholder: string;
    cta: string;
    submittingLabel: string;
    supportingText: string;
    successMessage: string;
    errorMessage: string;
    workflowSteps: WorkflowStep[];
  };
};

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    locale: "en",
    meta: {
      title: "Permudah — Turn your workflow into an AI product",
      description:
        "Turn your expertise, SOPs, and business logic into AI workflows you can sell to your audience.",
    },
    hero: {
      eyebrow: "AI WORKFLOW COMMERCE",
      headline: "Turn your workflow into an AI product.",
      subheadline:
        "Turn your expertise, SOPs, and business logic into AI workflows you can sell to your audience.",
      emailLabel: "Email address",
      emailPlaceholder: "you@example.com",
      cta: "Get Early Access",
      submittingLabel: "Joining...",
      supportingText:
        "Be among the first creators building with Permudah.",
      successMessage:
        "You're on the list. We'll be in touch when Permudah is ready.",
      errorMessage: "Something went wrong. Please try again.",
      workflowSteps: [
        {
          label: "Your expertise",
          description: "Skills, knowledge, SOPs, workflows",
          icon: "/images/permudah-icon-expertise.png",
        },
        {
          label: "AI Workflow",
          description: "Turn it into a working AI product",
          icon: "/images/permudah-icon-workflow.png",
        },
        {
          label: "Your product",
          description: "Publish and sell on your storefront",
          icon: "/images/permudah-icon-product.png",
        },
        {
          label: "Your customers",
          description: "They use it in ChatGPT (and beyond)",
          icon: "/images/permudah-icon-customers.png",
        },
      ],
    },
  },
  id: {
    locale: "id",
    meta: {
      title: "Permudah — Ubah workflow-mu menjadi produk AI",
      description:
        "Jadikan keahlian, SOP, dan business logic-mu sebagai AI workflow yang bisa kamu jual kepada audiensmu.",
    },
    hero: {
      eyebrow: "PLATFORM AI WORKFLOW COMMERCE",
      headline: "Ubah workflow-mu menjadi produk AI.",
      subheadline:
        "Jadikan keahlian, SOP, dan business logic-mu sebagai AI workflow yang bisa kamu jual kepada audiensmu.",
      emailLabel: "Alamat email",
      emailPlaceholder: "email@kamu.com",
      cta: "Dapatkan Early Access",
      submittingLabel: "Mendaftarkan...",
      supportingText:
        "Jadilah salah satu creator pertama yang membangun dengan Permudah.",
      successMessage:
        "Kamu sudah terdaftar. Kami akan menghubungimu saat Permudah siap.",
      errorMessage: "Terjadi kesalahan. Silakan coba lagi.",
      workflowSteps: [
        {
          label: "Keahlianmu",
          description: "Skill, pengetahuan, SOP, dan workflow",
          icon: "/images/permudah-icon-expertise.png",
        },
        {
          label: "AI Workflow",
          description: "Ubah menjadi produk AI yang berfungsi",
          icon: "/images/permudah-icon-workflow.png",
        },
        {
          label: "Produkmu",
          description: "Publikasikan dan jual di storefront-mu",
          icon: "/images/permudah-icon-product.png",
        },
        {
          label: "Pelangganmu",
          description: "Mereka menggunakannya di ChatGPT (dan lainnya)",
          icon: "/images/permudah-icon-customers.png",
        },
      ],
    },
  },
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "id";
}

export function getLocale(acceptLanguage: string | null | undefined): Locale {
  const header = acceptLanguage?.toLowerCase() ?? "";
  const preferred = header.split(",")[0]?.trim() ?? "";
  if (preferred.startsWith("id")) return "id";
  return "en";
}

export function resolveLocale(
  cookieOverride: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookieOverride)) return cookieOverride;
  return getLocale(acceptLanguage);
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}