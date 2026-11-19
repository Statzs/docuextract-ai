import { Link, useOutletContext } from "react-router"
import { motion } from "motion/react"
import { ArrowRight, ArrowUpRight, Download, FileStack, ListChecks, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorState, MethodBadge, PageHeader, StatusBadge, fadeUp } from "@/components/common"
import type { ShellContext } from "@/components/app-shell"
import { DemoTour } from "@/components/demo-tour"
import { useConfig, useDocuments, useMe, useUsage } from "@/lib/queries"
import { timeAgo } from "@/lib/format"

function Stat({ label, value, to, loading }: { label: string; value: number; to: string; loading?: boolean }) {
  return (
    <Link to={to} className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-2 h-7 w-12" /> : <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>}
    </Link>
  )
}

const STEPS = [
  { icon: UploadCloud, text: "Upload a PDF or a photo" },
  { icon: ListChecks, text: "Choose what kind of document it is" },
  { icon: Download, text: "Check the values and download" },
]

export function DashboardPage() {
  const { openUpload } = useOutletContext<ShellContext>()
  const { data: me } = useMe()
  const { data: config } = useConfig()
  const usage = useUsage(1)
  const recent = useDocuments({ page_size: 6 })
  const counts = usage.data?.status_counts ?? {}
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)

  return (
    <div className="space-y-8">
      <PageHeader title={`Hello, ${me?.name.split(" ")[0] ?? ""}`} description="Get the key information out of your documents." />

      {me?.is_demo && <DemoTour
          reviewDocId={recent.data?.items.find((d) => d.status === "needs_review")?.id}
          photoDocId={recent.data?.items.find((d) => d.status === "uploaded")?.id}
          onUpload={openUpload}
        />}

      <motion.section {...fadeUp} className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_right,black,transparent_70%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Extract information from a document</h2>
            <ol className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3 sm:gap-6">
              {STEPS.map((s, i) => (
                <li key={s.text} className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-highlight font-mono text-xs font-semibold text-highlight-foreground">
                    {i + 1}
                  </span>
                  {s.text}
                </li>
              ))}
            </ol>
            {config && (
              <p className="mt-4 text-xs text-muted-foreground">
                PDF, PNG, JPEG or WebP · up to {config.max_upload_mb} MB
                {config.retention_days ? ` · files are deleted automatically after ${config.retention_days} days` : ""}
              </p>
            )}
          </div>
          <Button size="lg" onClick={openUpload} className="shrink-0">
            <UploadCloud /> Upload a document
          </Button>
        </div>
      </motion.section>

      <motion.div {...fadeUp} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="All documents" value={total} to="/app/documents" loading={usage.isLoading} />
        <Stat label="To check" value={counts.needs_review ?? 0} to="/app/documents?filter=review" loading={usage.isLoading} />
        <Stat label="Checked" value={counts.validated ?? 0} to="/app/documents?filter=validated" loading={usage.isLoading} />
        <Stat label="Waiting for a type" value={counts.uploaded ?? 0} to="/app/documents?filter=waiting" loading={usage.isLoading} />
      </motion.div>

      <motion.section {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }} className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Recent documents</h2>
          <Button variant="ghost" size="sm" render={<Link to="/app/documents" />} nativeButton={false}>
            View all <ArrowUpRight />
          </Button>
        </div>
        {recent.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : recent.error ? (
          <div className="p-4">
            <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
          </div>
        ) : !recent.data?.items.length ? (
          <div className="p-4">
            <EmptyState
              icon={FileStack}
              title="No documents yet"
              description="Upload an invoice, receipt or contract to get started."
              action={<Button onClick={openUpload}>Upload a document</Button>}
            />
          </div>
        ) : (
          <ul className="divide-y">
            {recent.data.items.map((d) => (
              <li key={d.id}>
                <Link to={`/app/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.schema_name || "Type not chosen"} · {timeAgo(d.created_at)}
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex">
                    <MethodBadge provider={d.status === "needs_review" || d.status === "validated" ? d.provider : null} />
                  </span>
                  <StatusBadge status={d.status} />
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </motion.section>
    </div>
  )
}
