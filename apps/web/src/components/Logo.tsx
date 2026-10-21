export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 9.2h2.1L4.6 4.2 6.8 12l2.1-6.2 1.4 3.4H15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
