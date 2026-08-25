import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Catches a link to a page that does not exist at compile time rather than
   * as a 404 someone hits after signing in.
   */
  typedRoutes: true,

  /**
   * Playwright drives the app over 127.0.0.1 while `next dev` serves localhost.
   * Without this the dev server blocks its own chunks as cross-origin and the
   * e2e suite goes flaky. Development only — it has no effect on a build.
   */
  allowedDevOrigins: ['127.0.0.1'],
}

export default nextConfig
