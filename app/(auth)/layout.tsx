import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-sm font-semibold tracking-tight text-primary">
        RentEase
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
