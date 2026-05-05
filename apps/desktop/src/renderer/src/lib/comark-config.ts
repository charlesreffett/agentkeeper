import highlight from '@comark/vue/plugins/highlight'
import type { ThemeRegistration } from 'shiki'

export const transcriptPlugins = [
  highlight({
    themes: {
      light: 'material-theme-lighter' as ThemeRegistration,
      dark: 'material-theme-palenight' as ThemeRegistration,
    },
  }),
]
