import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fi from './locales/fi.json'

i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: { translation: en },
    fi: { translation: fi },
  },
  interpolation: { escapeValue: false },
})
