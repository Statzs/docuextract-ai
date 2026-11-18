import { Link, useOutletContext } from "react-router"
import { motion } from "motion/react"
import { ArrowUpRight, FileStack, Plus } from "lucide-react"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorState, PageHeader, StatusBadge, fadeUp } from "@/components/common"
import type { ShellContext } from "@/components/app-shell"
import { DemoTour } from "@/components/demo-tour"
import { useDocuments, useMe, useUsage } from "@/lib/queries"
import { compact, timeAgo } from "@/lib/format"

function Stat({ label, value, hint, loading }: { label: string; value: string | number; hint?: string; loading?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function DashboardPage() {
  const { openUpload } = useOutletContext<ShellContext>()
  const { data: me } = useMe()
  const usage = useUsage(14)
  const recent = useDocuments({ page_size: 6 })
  const counts = usage.data?.status_counts ?? {}
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hello, ${me?.name.split(" ")[0] ?? ""}`}
        description="Here is what is happening across your documents."
        actions={
          <Button onClick={openUpload}>
            <Plus /> New extraction
          </Button>
        }
      />

      {me?.is_demo && (
        <DemoTour reviewDocId={recent.data?.items.find((d) => d.status === "needs_review")?.id} onUpload={openUpload} />
      )}

      <motion.div {...fadeUp} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Documents" value={total} loading={usage.isLoading} />
        <Stat label="Awaiting review" value={counts.needs_review ?? 0} loading={usage.isLoading} />
        <Stat label="Validated" value={counts.validated ?? 0} loading={usage.isLoading} />
        <Stat
          label="Tokens · 14 days"
          value={compact((usage.data?.input_tokens ?? 0) + (usage.data?.output_tokens ?? 0))}
          hint={usage.data?.estimated ? "Includes estimates (demo)" : undefined}
          loading={usage.isLoading}
        />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
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
                description="Upload a PDF or image to extract its data with a schema."
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
                        {d.schema_name} · {timeAgo(d.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        <motion.section {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }} className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-medium">Requests · 14 days</h2>
            <Button variant="ghost" size="sm" render={<Link to="/app/usage" />} nativeButton={false}>
              Details <ArrowUpRight />
            </Button>
          </div>
          <div className="h-56 p-4">
            {usage.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : usage.error ? (
              <ErrorState error={usage.error} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usage.data?.series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => d.slice(8)}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="var(--muted-foreground)"
                    interval="preserveStartEnd"
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--muted-foreground)" }}
                  />
                  <Bar dataKey="requests" name="Requests" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  )
}
