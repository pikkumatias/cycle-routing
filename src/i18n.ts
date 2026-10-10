import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import fi from './locales/fi.json'

export type AppLanguage = 'en' | 'fi'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fi: { translation: fi },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'fi'],
    interpolation: { escapeValue: false },
  })

/** The active language, narrowed to the ones the app ships. */
export function appLanguage(lng: string | undefined = i18n.language): AppLanguage {
  return lng?.startsWith('fi') ? 'fi' : 'en'
}

function syncDocument(lng: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = appLanguage(lng)
  document.title = i18n.t('app.title')
}

i18n.on('languageChanged', syncDocument)
if (i18n.isInitialized) syncDocument(i18n.language)
else i18n.on('initialized', () => syncDocument(i18n.language))

export default i18n
