import type { ReactNode } from "react"

type Props = {
  eyebrow: string
  title: string
  subtitle?: string
  children?: ReactNode
}

export function PageHeader({ eyebrow, title, subtitle, children }: Props) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  )
}
