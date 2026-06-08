import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";
import { DEFAULT_LOCALE, i18nextResources, supportedLocales } from "./locales";

const LANGUAGE_STORAGE_KEY = "paperclip.ui.language";

function readStoredLanguage(): string {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function persistLanguage(locale: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // ignore quota errors
  }
}

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: readStoredLanguage(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n
  .use(initReactI18next)
  .init(i18nextOptions)
  .then(() => {
    // Keep in sync when language changes from any source
    i18n.on("languageChanged", (lng) => {
      persistLanguage(lng);
    });
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize i18next", error);
  });

export function changeLanguage(locale: string): Promise<unknown> {
  return i18n.changeLanguage(locale);
}

export { supportedLocales, DEFAULT_LOCALE };

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };
