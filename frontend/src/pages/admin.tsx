import { useEffect, useState, type FormEvent } from "react"
import { Navigate } from "react-router"
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ErrorState, PageHeader } from "@/components/common"
import { api, type AdminLimits } from "@/lib/api"
import { useAdminLimits, useAdminOverview, useMe } from "@/lib/queries"
import { formatDate } from "@/lib/format"

const METHOD_LABEL: Record<string, string> = { gemini: "AI (Gemini)", text: "PDF text", ocr: "OCR" }

const NUMBER_LIMITS: { key: Exclude<keyof AdminLimits, "ai_enabled">; label: string; hint: string }[] = [
  { key: "ai_daily_limit_per_user", label: "AI extractions per user per day", hint: "Over the limit, documents are read without AI." },
  { key: "ai_daily_limit_global", label: "AI extractions per day, all users", hint: "Keep it under your Gemini free-tier daily quota." },
  { key: "daily_documents_per_user", label: "Uploads per user per day", hint: "Protects the server from bulk uploads." },
  { key: "max_pdf_pages", label: "Maximum pages per PDF", hint: "Larger PDFs are refused at upload." },
  { key: "ocr_max_pages", label: "Pages read by OCR", hint: "OCR is slow on the free server; only the first pages are read." },
  { key: "retention_days", label: "Delete documents after (days)", hint: "0 keeps documents until users delete them." },
]

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-success" aria-label="OK" /> : <XCircle className="size-4 text-destructive" aria-label="Not available" />}
      {children}
    </p>
  )
}

export function AdminPage() {
  const { data: me } = useMe()
  const { data, error, isLoading, refetch } = useAdminOverview()
  const save = useAdminLimits()
  const [limits, setLimits] = useState<AdminLimits | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- form starts from the server copy
    if (data && !limits) setLimits(data.limits)
  }, [data, limits])

  if (me && !me.is_admin) return <Navigate to="/app" replace />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !data || !limits) return <Skeleton className="h-96 w-full" />

  const g = data.gemini
  async function check() {
    setChecking(true)
    try {
      const r = await api.adminGeminiCheck()
      if (r.ok) toast.success(r.message)
      else toast.error(r.message)
    } finally {
      setChecking(false)
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(limits!)
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Admin panel" description="Only you can see this page. Figures are for all users; documents stay private to their owners." />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="AI extractions today" value={`${g.calls_today} / ${data.quota.global_limit}`} hint={`${data.quota.global_remaining} left today`} />
        <Stat label="Documents today" value={data.documents.today} hint={`${data.documents.total} stored in total`} />
        <Stat label="Failed extractions" value={data.documents.failed_today} hint={`${data.documents.failed_total} in total`} />
        <Stat label="Average processing time" value={`${(data.documents.avg_processing_ms_7d / 1000).toFixed(1)} s`} hint="Last 7 days" />
        <Stat label="Registered users" value={data.users.registered} hint={`${data.users.new_today} new today`} />
        <Stat label="Active demo workspaces" value={data.users.demo_workspaces} hint="Deleted after 24 hours" />
        <Stat
          label="Extractions today by method"
          value={Object.values(data.documents.extractions_today_by_method).reduce((a, b) => a + b, 0)}
          hint={Object.entries(data.documents.extractions_today_by_method).map(([k, v]) => `${METHOD_LABEL[k] ?? k}: ${v}`).join(" · ") || "None yet"}
        />
        <Stat label="Upload size limit" value={`${data.max_upload_mb} MB`} hint="Set by the server (MAX_UPLOAD_MB)" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-medium">Gemini</h2>
          <Status ok={g.configured}>{g.configured ? `API key set · model ${g.model}` : "No API key on the server (GEMINI_API_KEY)"}</Status>
          <Status ok={g.enabled}>{g.enabled ? "AI extraction is on" : "AI extraction is paused (switch below)"}</Status>
          <p className="text-sm text-muted-foreground">
            Last success: {g.last_success_at ? formatDate(g.last_success_at) : "never"} · failures today: {g.failures_today}
          </p>
          {g.last_error && (
            <p className="flex gap-2 rounded-lg bg-destructive/5 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-px size-3.5 shrink-0" /> {g.last_error_at && `${formatDate(g.last_error_at)}: `}
              {g.last_error}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={check} disabled={checking}>
            {checking && <Loader2 className="animate-spin" />} Check the key now
          </Button>
        </div>
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-medium">Fallback methods (no AI)</h2>
          <Status ok={data.fallbacks.pdf_text}>PDF text reading</Status>
          <Status ok={data.fallbacks.ocr}>
            OCR for scans and photos{data.fallbacks.ocr ? ` (${data.fallbacks.ocr_languages.join(", ")})` : " — Tesseract not installed"}
          </Status>
          <p className="text-sm text-muted-foreground">
            Used automatically in private mode, for demo workspaces, and whenever Gemini is unavailable or over its limit.
          </p>
        </div>
      </section>

      <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-medium">Limits</h2>
          <p className="text-sm text-muted-foreground">Changes apply immediately to everyone.</p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="ai-enabled">Use AI (Gemini)</Label>
            <p className="text-xs text-muted-foreground">Off: every document is read with the free methods.</p>
          </div>
          <Switch id="ai-enabled" checked={limits.ai_enabled} onCheckedChange={(v) => setLimits({ ...limits, ai_enabled: !!v })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBER_LIMITS.map((l) => (
            <div key={l.key} className="grid gap-1.5">
              <Label htmlFor={l.key}>{l.label}</Label>
              <Input
                id={l.key}
                type="number"
                inputMode="numeric"
                min={0}
                value={limits[l.key]}
                onChange={(e) => setLimits({ ...limits, [l.key]: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{l.hint}</p>
            </div>
          ))}
        </div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save limits
        </Button>
      </form>

      <section className="rounded-xl border bg-card">
        <h2 className="border-b px-5 py-3 font-medium">Recent failed extractions</h2>
        {data.recent_failures.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No failures.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.recent_failures.map((f, i) => (
              <li key={i} className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_8rem_1fr]">
                <span className="text-muted-foreground">{f.at ? formatDate(f.at) : "—"}</span>
                <span className="text-muted-foreground">
                  {f.type.split("/")[1]} · {f.mode}
                </span>
                <span>{f.error}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
