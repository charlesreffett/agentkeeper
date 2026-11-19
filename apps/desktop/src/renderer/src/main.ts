import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { queryClient } from './lib/queryClient'
import router from './router'
import App from './App.vue'
import { applyCachedTheme, applyThemeToDocument } from './lib/theme'
import { DEFAULT_THEMES, deriveTheme } from '@shared/theme'
import './style.css'
import 'vue-sonner/style.css'
import '@fontsource/opendyslexic/latin-400.css'
import '@fontsource/opendyslexic/latin-700.css'

if (!applyCachedTheme()) applyThemeToDocument(deriveTheme(DEFAULT_THEMES.dark, 'dark'))

const app = createApp(App)
app.use(createPinia())
app.use(VueQueryPlugin, { queryClient })
app.use(router)
app.mount('#app')
