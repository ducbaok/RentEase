import { Chivo, IBM_Plex_Mono, Newsreader } from 'next/font/google'
import styles from './marketing.module.css'

/**
 * The public pages: the landing page and the handbook.
 *
 * These are the only routes a stranger sees, so they get their own typography
 * and palette rather than the app's. `next/font` self-hosts each face and
 * exposes it as a CSS variable, which keeps the faces out of the signed-in
 * bundles and off Google's servers at request time.
 *
 * Chivo and Newsreader are variable fonts, so no weight is declared — the whole
 * range ships in one file. IBM Plex Mono is not, so its weights are listed.
 */

const display = Chivo({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const body = Newsreader({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable} ${styles.root}`}>
      {children}
    </div>
  )
}
