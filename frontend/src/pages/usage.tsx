import { useState } from "react"
import { Info } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState, PageHeader } from "@/components/common"
import { useConfig, useUsage } from "@/lib/queries"
import { compact } from "@/lib/format"
import { cn } from "@/lib/utils"

const RANGES = [7, 30, 90]

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }

export function UsagePage() {
  const [days, setDays] = useState(30)
  const { data, isLoading, error, refetch } = useUsage(days)
  const { data: config } = useConfig()
  const successRate = data?.total_requests ? Math.round(((data.total_requests - data.failed_requests) / data.total_requests) * 100) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="API usage"
        description={config ? `Every extraction attempt is metered, including retries. Provider: ${config.provider} · ${config.model}` : undefined}
        actions={
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={cn("h-7 rounded-md px-3 text-xs font-medium transition-colors", days === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {r}d
              </button>
            ))}
          </div>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          {data.estimated && (
            <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              Some token counts are estimates (≈ 4 characters per token) because they come from the offline demo extractor. Gemini requests use the exact counts reported by the API.
            </p>
          )}
          <div className="grid grid-cols-2 divide-x divide-y rounded-xl border bg-card md:grid-cols-4 md:divide-y-0 [&>*:nth-child(2)]:border-r-0 md:[&>*:nth-child(2)]:border-r">
            <Metric label="Requests" value={String(data.total_requests)} sub={`last ${days} days`} />
            <Metric label="Success rate" value={successRate === null ? "—" : `${successRate}%`} sub={`${data.failed_requests} failed attempts`} />
            <Metric label="Tokens (in / out)" value={`${compact(data.input_tokens)} / ${compact(data.output_tokens)}`} />
            <Metric label="Avg. latency" value={data.total_requests ? `${data.avg_latency_ms} ms` : "—"} sub="per attempt" />
          </div>

          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-medium">Tokens per day</h2>
            <div className="h-80 p-4 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-in" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={24} />
                  <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={48} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--muted-foreground)" }} />
                  <Area type="monotone" dataKey="input_tokens" name="Input tokens" stroke="var(--chart-1)" fill="url(#g-in)" strokeWidth={1.75} />
                  <Area type="monotone" dataKey="output_tokens" name="Output tokens" stroke="var(--chart-3)" fill="transparent" strokeWidth={1.75} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-medium">Requests and failures per day</h2>
            <div className="h-56 p-4 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={48} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--muted-foreground)" }} />
                  <Area type="step" dataKey="requests" name="Requests" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} strokeWidth={1.5} />
                  <Area type="step" dataKey="failures" name="Failures" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.12} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
