import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, ArrowLeft, Check, Info, Loader2, RotateCw, Save, Sparkles, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfidenceMeter, ErrorState, StatusBadge } from "@/components/common"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ExportMenu } from "@/components/export-menu"
import { api, ApiError, type DocumentDetail, type FieldDef, type FieldValue } from "@/lib/api"
import { useDeleteDocument, useDocument, useRetry, useReview } from "@/lib/queries"
import { formatBytes, formatDate, parseInput, timeAgo, toInput } from "@/lib/format"
import { cn } from "@/lib/utils"

function currentValues(doc: DocumentDetail): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of doc.schema_snapshot) {
    const v: FieldValue = doc.reviewed_data && f.key in doc.reviewed_data ? doc.reviewed_data[f.key] : (doc.extracted_data?.[f.key]?.value ?? null)
    out[f.key] = toInput(v, f.type)
  }
  return out
}

function FieldInput({ field, value, onChange, error }: { field: FieldDef; value: string; onChange: (v: string) => void; error?: string }) {
  const id = `field-${field.key}`
  if (field.type === "boolean") {
    return (
      <Select
        items={[
          { value: "", label: "Not set" },
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
        value={value}
        onValueChange={(v) => onChange((v as string) ?? "")}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Not set</SelectItem>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // Plain text even for dates: an unparseable AI value must stay visible for correction.
      type="text"
      inputMode={field.type === "number" || field.type === "currency" ? "decimal" : undefined}
      className="font-mono text-[13px]"
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      placeholder={field.type === "date" ? "YYYY-MM-DD" : "Not found"}
    />
  )
}

function Preview({ doc }: { doc: DocumentDetail }) {
  const [loaded, setLoaded] = useState(false)
  const url = api.fileUrl(doc.id)
  return (
    <div className="relative h-[50vh] min-h-[360px] overflow-hidden rounded-xl border bg-surface xl:sticky xl:top-6 xl:h-[calc(100dvh-8rem)]">
      {!loaded && <Skeleton className="absolute inset-3" />}
      {doc.mime_type === "application/pdf" ? (
        <iframe src={`${url}#view=FitH&toolbar=0`} title={`Preview of ${doc.filename}`} className="size-full" onLoad={() => setLoaded(true)} />
      ) : (
        <div className="size-full overflow-auto p-4">
          <img src={url} alt={`Uploaded document ${doc.filename}`} className="mx-auto max-w-full rounded shadow-sm" onLoad={() => setLoaded(true)} />
        </div>
      )}
    </div>
  )
}

export function DocumentDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { data: doc, error, isLoading, refetch } = useDocument(id)
  const review = useReview(id)
  const retry = useRetry()
  const del = useDeleteDocument()
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRerun, setConfirmRerun] = useState(false)

  const original = useMemo(() => (doc ? currentValues(doc) : {}), [doc])
  // Reset the form whenever the server copy changes (load, re-extraction, save).
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- intentional: resync form with server copy
    setValues(original)
    setFieldErrors({})
  }, [original])

  const dirtyKeys = Object.keys(values).filter((k) => values[k] !== original[k])
  const reviewable = doc?.status === "needs_review" || doc?.status === "validated"

  async function save(validate: boolean) {
    if (!doc) return
    const payload: Record<string, FieldValue> = {}
    for (const f of doc.schema_snapshot) {
      if (validate || dirtyKeys.includes(f.key)) payload[f.key] = parseInput(values[f.key] ?? "", f.type)
    }
    try {
      await review.mutateAsync({ values: payload, validate })
      toast.success(validate ? "Document validated" : "Changes saved")
    } catch (e) {
      const err = e as ApiError
      setFieldErrors(err.fields ?? {})
      toast.error(err.message)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save(true)
  }

  if (error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorState error={error} onRetry={(error as ApiError).status === 404 ? undefined : () => refetch()} />
      </div>
    )
  }
  if (isLoading || !doc) return <DetailSkeleton />

  const extracted = doc.extracted_data ?? {}
  const found = doc.schema_snapshot.filter((f) => extracted[f.key]?.value != null).length

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{doc.filename}</h1>
            <StatusBadge status={doc.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.schema_name} · {formatBytes(doc.size_bytes)}
            {doc.page_count ? ` · ${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}` : ""} · uploaded {formatDate(doc.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline"
            // Re-running replaces the AI output and drops human edits, so ask first when there are any.
            onClick={() => (doc.reviewed_data || doc.status === "validated" ? setConfirmRerun(true) : retry.mutate(doc.id))}
            disabled={!reviewable && doc.status !== "failed"}>
            <RotateCw /> Re-run
          </Button>
          <ExportMenu ids={[doc.id]} disabled={!reviewable} />
          <Button variant="ghost" size="icon" aria-label="Delete document" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Preview doc={doc} />

        <section className="min-w-0 rounded-xl border bg-card" aria-labelledby="fields-title">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
            <div>
              <h2 id="fields-title" className="text-sm font-medium">
                Extracted fields
              </h2>
              {reviewable && (
                <p className="text-xs text-muted-foreground">
                  {found} of {doc.schema_snapshot.length} found · {doc.provider === "demo" ? "offline demo extractor" : doc.model}
                </p>
              )}
            </div>
            {doc.validated_at && (
              <span className="shrink-0 text-xs text-muted-foreground" title={formatDate(doc.validated_at)}>
                Validated {timeAgo(doc.validated_at)}
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            {(doc.status === "queued" || doc.status === "processing") && (
              <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 p-5">
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="size-4 animate-spin" />
                  {doc.status === "queued" ? "Queued for extraction…" : "Reading the document…"}
                </p>
                {doc.schema_snapshot.map((f, i) => (
                  <div key={f.key} className="space-y-2">
                    <p className="text-xs text-muted-foreground">{f.label}</p>
                    <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.08 }}>
                      <Skeleton className="h-8 w-full" />
                    </motion.div>
                  </div>
                ))}
              </motion.div>
            )}

            {doc.status === "failed" && (
              <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-5">
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="flex items-center gap-2 font-medium text-destructive">
                    <AlertTriangle className="size-4" /> Extraction failed
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{doc.error}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Attempts: {doc.attempts}</p>
                  <Button className="mt-4" size="sm" onClick={() => retry.mutate(doc.id)} disabled={retry.isPending}>
                    <RotateCw /> Try again
                  </Button>
                </div>
              </motion.div>
            )}

            {reviewable && (
              <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onSubmit={onSubmit} className="flex flex-col">
                {doc.notes && (
                  <p className="mx-5 mt-4 flex gap-2 rounded-lg bg-info/10 px-3 py-2 text-xs text-info">
                    <Info className="mt-px size-3.5 shrink-0" /> {doc.notes}
                  </p>
                )}
                <div className="divide-y">
                  {doc.schema_snapshot.map((f) => {
                    const ai = extracted[f.key]
                    const edited = doc.reviewed_data && f.key in doc.reviewed_data && toInput(ai?.value ?? null, f.type) !== original[f.key]
                    const dirty = values[f.key] !== original[f.key]
                    return (
                      <div key={f.key} className={cn("grid gap-1.5 px-5 py-3.5 transition-colors", dirty && "bg-highlight/5")}>
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={`field-${f.key}`} className="gap-1">
                            {f.label}
                            {f.required && (
                              <span className="text-destructive" aria-label="required">
                                *
                              </span>
                            )}
                            <span className="ml-1 font-mono text-[10px] font-normal tracking-wide text-muted-foreground uppercase">{f.type}</span>
                          </Label>
                          <div className="flex items-center gap-2">
                            {edited && !dirty && <span className="text-[11px] whitespace-nowrap text-muted-foreground">edited</span>}
                            {dirty && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Undo change to ${f.label}`}
                                onClick={() => setValues((v) => ({ ...v, [f.key]: original[f.key] }))}
                              >
                                <Undo2 />
                              </Button>
                            )}
                            {ai && <ConfidenceMeter value={ai.confidence} />}
                          </div>
                        </div>
                        <FieldInput
                          field={f}
                          value={values[f.key] ?? ""}
                          onChange={(v) => {
                            setValues((prev) => ({ ...prev, [f.key]: v }))
                            setFieldErrors((prev) => {
                              const next = { ...prev }
                              delete next[f.key]
                              return next
                            })
                          }}
                          error={fieldErrors[f.key]}
                        />
                        {fieldErrors[f.key] && (
                          <p id={`field-${f.key}-error`} className="text-xs text-destructive">
                            {fieldErrors[f.key]}
                          </p>
                        )}
                        {ai && ai.confidence > 0 && ai.confidence < 0.6 && !fieldErrors[f.key] && (
                          <p className="flex items-center gap-1 text-xs text-warning">
                            <Sparkles className="size-3" /> Low confidence — please double-check.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-card/95 px-5 py-3 backdrop-blur">
                  <span className="mr-auto text-xs text-muted-foreground">{dirtyKeys.length ? `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? "s" : ""}` : "All changes saved"}</span>
                  <Button type="button" variant="outline" disabled={!dirtyKeys.length || review.isPending} onClick={() => save(false)}>
                    <Save /> Save draft
                  </Button>
                  <Button type="submit" disabled={review.isPending}>
                    {review.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                    {doc.status === "validated" ? "Re-validate" : "Validate"}
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this document?"
        description={`"${doc.filename}" and its extracted data will be permanently removed. This cannot be undone.`}
        onConfirm={() => del.mutate(doc.id, { onSuccess: () => navigate("/app/documents") })}
      />
      <ConfirmDialog
        open={confirmRerun}
        onOpenChange={setConfirmRerun}
        title="Re-run extraction?"
        description="The document is read again from scratch. Your reviewed values and validation will be discarded."
        confirmLabel="Re-run"
        onConfirm={() => retry.mutate(doc.id)}
      />
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/app/documents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="size-4" /> Documents
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Skeleton className="h-[60vh]" />
        <div className="space-y-4 rounded-xl border p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
