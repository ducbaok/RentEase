'use client'

/**
 * The last line of defence: an error in the ROOT layout itself.
 *
 * This boundary replaces the whole document, so it has to render its own <html>
 * and <body> — and it cannot rely on anything the root layout provides,
 * including the stylesheet. Hence the inline styles: a fallback that depends on
 * the thing that just failed is not a fallback.
 *
 * Like every other boundary here it shows the digest rather than the message.
 * The full error is in the server log against that reference.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#fff',
          color: '#0a0a0a',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            RentEase could not start this page
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, color: '#525252' }}>
            Something failed before the application finished loading. Nothing was changed. Reload,
            and if it happens again quote the reference below.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              borderRadius: '0.375rem',
              border: 'none',
              background: '#0a0a0a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: '#737373' }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
