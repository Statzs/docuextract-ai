import type { ReactNode } from "react"
import { motion } from "motion/react"
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, Loader2, type LucideIcon } from "lucide-react"
import type { DocStatus } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function Logo({ className }: { className?: string }) {
  // A page whose middle line is "highlighted": the product in one glyph.
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect x="4" y="2.5" width="16" height="19" rx="3" className="fill-foreground" />
        <rect x="7" y="7" width="8" height="1.6" rx=".8" className="fill-background/60" />
        <rect x="6" y="10.6" width="12" height="3.4" rx="1" className="fill-highlight" />
        <rect x="7" y="16.2" width="6" height="1.6" rx=".8" className="fill-background/60" />
      </svg>
      <span>
        DocuExtract<span className="text-muted-foreground font-normal"> AI</span>
      </span>
    </span>
  )
}

const STATUS: Record<DocStatus, { label: string; icon: LucideIcon; className: string; spin?: boolean }> = {
  queued: { label: "Queued", icon: Clock3, className: "text-muted-foreground bg-muted" },
  processing: { label: "Processing", icon: Loader2, className: "text-info bg-info/10", spin: true },
  needs_review: { label: "Needs review", icon: CircleDashed, className: "text-warning bg-warning/12" },
  validated: { label: "Validated", icon: CheckCircle2, className: "text-success bg-success/12" },
  failed: { label: "Failed", icon: AlertTriangle, className: "text-destructive bg-destructive/10" },
}

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v.label]),
) as Record<DocStatus, string>

export function StatusBadge({ status }: { status: DocStatus }) {
  const s = STATUS[status]
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        s.className,
      )}
    >
      <s.icon className={cn("size-3.5", s.spin && "animate-spin")} aria-hidden />
      {s.label}
    </span>
  )
}

export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.8 ? "bg-success" : value >= 0.5 ? "bg-warning" : "bg-destructive"
  return (
    <span className="inline-flex items-center gap-1.5" title={`Model confidence ${pct}%`}>
      <span className="relative h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[11px] text-muted-foreground tabular">{pct}%</span>
    </span>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center"
    >
      <div className="mb-4 grid size-11 place-items-center rounded-xl border bg-card shadow-xs">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="mb-3 size-5 text-destructive" />
      <p className="font-medium">Couldn't load this</p>
      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: [0.2, 0.7, 0.2, 1] as const },
}
