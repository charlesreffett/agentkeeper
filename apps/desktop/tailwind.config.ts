import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import typography from '@tailwindcss/typography'

// Tailwind 3 can't apply `/50` opacity modifiers to bare var() colors and
// silently emits nothing; color-mix with <alpha-value> makes them work.
const token = (name: string) => `color-mix(in oklab, var(--${name}) calc(<alpha-value> * 100%), transparent)`
const pair = (name: string, fg = `${name}-foreground`) => ({ DEFAULT: token(name), foreground: token(fg) })

export default {
  darkMode: ['class', '.dark'],
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{vue,ts,tsx}',
  ],
  theme: {
  	container: {
  		center: true,
  		padding: '1rem'
  	},
  	extend: {
  		colors: {
  			border: token('border'),
  			input: token('input'),
  			ring: token('ring'),
  			background: token('background'),
  			foreground: token('foreground'),
  			primary: pair('primary'),
  			secondary: pair('secondary'),
  			destructive: pair('destructive'),
  			success: pair('success'),
  			warning: pair('warning'),
  			info: pair('info'),
  			highlight: pair('highlight'),
  			brand: pair('brand'),
  			muted: pair('muted'),
  			accent: pair('accent'),
  			popover: {
  				DEFAULT: token('popover'),
  				foreground: token('popover-foreground'),
  				border: token('popover-border')
  			},
  			card: pair('card'),
  			code: pair('code-background', 'code-foreground'),
  			diff: {
  				added: token('diff-added'),
  				removed: token('diff-removed')
  			},
  			sidebar: {
  				DEFAULT: token('sidebar-background'),
  				foreground: token('sidebar-foreground'),
  				primary: token('sidebar-primary'),
  				'primary-foreground': token('sidebar-primary-foreground'),
  				accent: token('sidebar-accent'),
  				'accent-foreground': token('sidebar-accent-foreground'),
  				border: token('sidebar-border'),
  				ring: token('sidebar-ring')
  			}
  		},
  		boxShadow: {
  			overlay: 'var(--shadow-popover)',
  			dialog: 'var(--shadow-dialog)'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			sans: ['var(--font-sans)'],
  			mono: ['var(--font-mono)']
  		}
  	}
  },
  plugins: [animate, typography],
} satisfies Config
