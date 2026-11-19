import { Link } from "react-router"
import { CreditCard, File, FileText, Lock, Receipt, ScrollText, ShoppingCart, Sparkles, WandSparkles, type LucideIcon } from "lucide-react"
import type { AiStatus, ExtractionSchema, ExtractMode } from "@/lib/api"
import { cn } from "@/lib/utils"

const KIND_ICON: Record<string, LucideIcon> = {
  invoice: FileText,
  receipt: Receipt,
  contract: ScrollText,
  purchase_order: ShoppingCart,
  payment_record: CreditCard,
  general: File,
}

/** "What kind of document is this?": built-in templates first, then the user's own. */
export function TypeChooser({
  schemas,
  value,
  suggested,
  onChange,
  onNavigate,
}: {
  schemas: ExtractionSchema[]
  value: string | null
  suggested?: string | null
  onChange: (id: string) => void
  onNavigate?: () => void
}) {
  return (
    <div role="radiogroup" aria-label="Document type" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {schemas.map((s) => {
        const Icon = (s.kind && KIND_ICON[s.kind]) || WandSparkles
        const selected = value === s.id
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(s.id)}
            className={cn(
              "relative flex min-h-16 flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "border-foreground/60 bg-highlight/10 ring-1 ring-foreground/20" : "hover:bg-muted/50",
            )}
          >
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium leading-tight">{s.name}</span>
            {suggested === s.id && (
              <span className="absolute top-2 right-2 rounded-full bg-highlight px-1.5 py-px text-[10px] font-medium text-highlight-foreground">
                Suggested
              </span>
            )}
          </button>
        )
      })}
      <Link
        to="/app/schemas"
        onClick={onNavigate}
        className="flex min-h-16 flex-col items-start gap-1 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <WandSparkles className="size-4" aria-hidden />
        <span className="font-medium leading-tight">Custom extraction</span>
        <span className="text-xs">Choose your own fields</span>
      </Link>
    </div>
  )
}

/** AI or private reading. AI is only offered when it would actually be used. */
export function ModeChooser({ status, value, onChange }: { status?: AiStatus; value: ExtractMode; onChange: (m: ExtractMode) => void }) {
  if (!status) return null
  if (!status.available) {
    return (
      <p className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          {status.reason?.replace(/, so standard text reading was used\.?/, ".")} We'll read the document with standard text
          recognition, privately on our server.
        </span>
      </p>
    )
  }
  const options = [
    {
      id: "auto" as const,
      icon: Sparkles,
      title: "Smart (AI)",
      body: "Most accurate. Sent to Google Gemini; don't use it for confidential or personal documents.",
    },
    {
      id: "private" as const,
      icon: Lock,
      title: "Private (no AI)",
      body: "Read on our server with text recognition. Best for clear, labelled documents.",
    },
  ]
  return (
    <div role="radiogroup" aria-label="How to read the document" className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            value === o.id ? "border-foreground/60 bg-highlight/10 ring-1 ring-foreground/20" : "hover:bg-muted/50",
          )}
        >
          <o.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="block text-sm font-medium">{o.title}</span>
            <span className="block text-xs text-muted-foreground">{o.body}</span>
          </span>
        </button>
      ))}
      {status.remaining_today != null && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {status.remaining_today} AI extraction{status.remaining_today === 1 ? "" : "s"} left today. After that, documents are read
          without AI automatically.
        </p>
      )}
    </div>
  )
}
