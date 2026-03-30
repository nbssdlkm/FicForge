import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      zh: {
        translation: zh,
      },
    },
    lng: "zh",
    fallbackLng: "zh",
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });
}

export default i18n;
