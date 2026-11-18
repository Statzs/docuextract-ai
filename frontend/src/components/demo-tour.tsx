import { useState } from "react"
import { Link } from "react-router"
import { motion } from "motion/react"
import { ArrowRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const KEY = "dx-demo-tour-dismissed"

function readDismissed() {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

/** A four-step "start here" card for demo visitors. Dismissal is a per-browser convenience. */
export function DemoTour({ reviewDocId, onUpload }: { reviewDocId?: string; onUpload: () => void }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null

  const steps = [
    {
      title: "Review an extraction",
      body: "Compare each value with the original and fix anything the model got wrong.",
      action: reviewDocId ? { to: `/app/documents/${reviewDocId}`, label: "Open one" } : undefined,
    },
    { title: "Extract a sample", body: "Upload one of the fictional PDFs and watch it get processed.", onClick: onUpload, label: "Upload" },
    { title: "Shape the schema", body: "Fields, types and hints decide what gets extracted.", action: { to: "/app/schemas", label: "Edit schemas" } },
    { title: "Export clean data", body: "Select documents and download CSV, Excel or JSON.", action: { to: "/app/documents", label: "Go to documents" } },
  ]

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(KEY, "1")
    } catch {
      /* storage unavailable: hide for this visit only */
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="tour-title"
      className="relative rounded-xl border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="tour-title" className="text-sm font-medium">
            <span className="marker">Start here</span> — a two-minute tour
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is a private, throwaway workspace with fictional documents. Nothing you do here costs anything.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss the tour" onClick={dismiss}>
          <X />
        </Button>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-lg border bg-surface p-3">
            <span className="grid size-6 place-items-center rounded-full bg-highlight font-mono text-xs font-semibold text-highlight-foreground">
              {i + 1}
            </span>
            <p className="mt-2 text-sm font-medium">{s.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{s.body}</p>
            {s.action ? (
              <Button variant="link" size="sm" className="mt-2 h-auto self-start p-0" render={<Link to={s.action.to} />} nativeButton={false}>
                {s.action.label} <ArrowRight />
              </Button>
            ) : s.onClick ? (
              <Button variant="link" size="sm" className="mt-2 h-auto self-start p-0" onClick={s.onClick}>
                {s.label} <ArrowRight />
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </motion.section>
  )
}
