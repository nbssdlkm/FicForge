import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Read persisted language preference from localStorage.
 * Falls back to "zh" when nothing is stored or value is invalid.
 */
function getInitialLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem("ficforge_language");
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as AppLanguage;
    }
  } catch {
    // localStorage unavailable (e.g. SSR) — fall through
  }
  return "zh";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: "zh",
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });
}

/**
 * Switch UI language and persist the choice to localStorage.
 * TODO: Task B — sync language to backend settings.yaml for prompt language selection.
 */
export async function changeLanguage(lang: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    localStorage.setItem("ficforge_language", lang);
  } catch {
    // ignore
  }
}

export default i18n;
