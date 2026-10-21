import { motion, useReducedMotion } from "framer-motion"
import type { ReactNode } from "react"

type Props = {
  active: boolean
  scroll?: boolean
  children: ReactNode
}

export function PagePane({ active, scroll = false, children }: Props) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={`page-fill ${scroll ? "is-scroll" : ""} ${active ? "is-active" : ""}`}
      inert={!active}
      aria-hidden={active ? undefined : true}
      initial={false}
      animate={{ opacity: active ? 1 : 0, y: active || reduce ? 0 : 8 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
