import { useRef, useState, type DragEvent } from "react"
import { useNavigate } from "react-router"
import { AnimatePresence, motion } from "motion/react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, CheckCircle2, FileText, ImageIcon, Loader2, UploadCloud, X, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ModeChooser, TypeChooser } from "@/components/extract-options"
import { useAiStatus, useConfig, useExtract, useSchemas, useUpload } from "@/lib/queries"
import { formatBytes } from "@/lib/format"
import { api, type DocumentDetail, type ExtractMode } from "@/lib/api"
import { cn } from "@/lib/utils"

type Item = {
  id: string
  file: File
  state: "uploading" | "uploaded" | "error"
  error?: string
  doc?: DocumentDetail
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp"
const MIME_OK = ["application/pdf", "image/png", "image/jpeg", "image/webp"]

/**
 * The main flow, in plain steps: 1) pick a file (it uploads right away), 2) say what kind of
 * document it is (pre-selected when the text makes it obvious), 3) Extract information.
 */
export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: schemas = [] } = useSchemas()
  const { data: config } = useConfig()
  const { data: aiStatus } = useAiStatus(open)
  const upload = useUpload()
  const extract = useExtract()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [schemaId, setSchemaId] = useState<string | null>(null)
  const [mode, setMode] = useState<ExtractMode>("auto")
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: samples = [] } = useQuery({ queryKey: ["samples"], queryFn: api.samples, enabled: open, staleTime: Infinity })

  const maxMb = config?.max_upload_mb ?? 10
  const uploaded = items.filter((i) => i.state === "uploaded")
  const uploading = items.some((i) => i.state === "uploading")
  const step = items.length === 0 ? "file" : "type"
  const suggested = uploaded.find((i) => i.doc?.suggested_schema_id)?.doc?.suggested_schema_id ?? null

  const patch = (id: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)))

  async function addFiles(files: File[]) {
    const next: Item[] = files.slice(0, 10).map((file) => {
      // Client checks are for fast feedback only; the server re-validates by magic bytes.
      const error = !MIME_OK.includes(file.type)
        ? "Use a PDF, PNG, JPEG or WebP file."
        : file.size > maxMb * 1024 * 1024
          ? `Larger than ${maxMb} MB.`
          : undefined
      return { id: crypto.randomUUID(), file, state: error ? "error" : "uploading", error }
    })
    setItems((prev) => [...prev, ...next])
    for (const item of next.filter((i) => i.state === "uploading")) {
      try {
        const doc = await upload.mutateAsync({ file: item.file })
        patch(item.id, { state: "uploaded", doc })
        if (doc.suggested_schema_id) setSchemaId((cur) => cur ?? doc.suggested_schema_id)
      } catch (e) {
        patch(item.id, { state: "error", error: (e as Error).message })
      }
    }
  }

  async function addSample(filename: string, schemaName: string) {
    try {
      const file = await api.sampleFile(filename)
      const match = schemas.find((s) => s.name === schemaName)
      if (match) setSchemaId(match.id)
      await addFiles([file])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  async function start() {
    if (!schemaId) return
    setBusy(true)
    const opened: string[] = []
    for (const item of uploaded) {
      const doc = item.doc!
      // An earlier copy that is already extracted is just opened, not processed again.
      if (doc.duplicate && doc.status !== "uploaded" && doc.status !== "failed") {
        opened.push(doc.id)
        continue
      }
      try {
        await extract.mutateAsync({ id: doc.id, schemaId, mode })
        opened.push(doc.id)
      } catch (e) {
        patch(item.id, { state: "error", error: (e as Error).message })
      }
    }
    setBusy(false)
    if (!opened.length) return
    if (uploaded.some((i) => i.doc?.duplicate)) toast.info("You had already uploaded this file, so we opened that copy.")
    close()
    navigate(opened.length === 1 ? `/app/documents/${opened[0]}` : "/app/documents")
  }

  function close() {
    onOpenChange(false)
    setTimeout(() => {
      setItems([])
      setSchemaId(null)
      setMode("auto")
    }, 200)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !busy && close())}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{step === "file" ? "Upload a document" : "What kind of document is it?"}</DialogTitle>
          <DialogDescription>
            {step === "file"
              ? `PDF or photo (PNG, JPEG, WebP), up to ${maxMb} MB${config ? ` and ${config.max_pdf_pages} pages` : ""}.`
              : "Pick the closest type. It decides which information we look for."}
          </DialogDescription>
        </DialogHeader>

        <Steps step={step} />

        {step === "file" ? (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "group relative flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                dragging ? "border-foreground/40 bg-highlight/10" : "hover:bg-muted/50",
              )}
            >
              <motion.div animate={{ y: dragging ? -3 : 0 }} className="grid size-11 place-items-center rounded-lg border bg-card shadow-xs">
                <UploadCloud className="size-5 text-muted-foreground" />
              </motion.div>
              <p className="text-sm">
                <span className="font-medium">Drop a file here</span> <span className="text-muted-foreground">or tap to choose one</span>
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                data-testid="file-input"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []))
                  e.target.value = ""
                }}
              />
            </button>
            {samples.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">No document handy? Try a fictional example:</p>
                <div className="flex flex-wrap gap-1.5">
                  {samples.map((s) => (
                    <Button key={s.filename} variant="outline" size="xs" onClick={() => addSample(s.filename, s.schema)}>
                      {s.filename.endsWith(".pdf") ? <FileText /> : <ImageIcon />} {s.filename.replace(/\.(pdf|png)$/, "")}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <ul className="space-y-1">
              <AnimatePresence initial={false}>
                {items.map((i) => (
                  <motion.li
                    key={i.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm"
                  >
                    {i.file.type.startsWith("image/") ? (
                      <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{i.file.name}</p>
                      <p className={cn("text-xs", i.error ? "text-destructive" : "text-muted-foreground")}>
                        {i.error ?? (i.state === "uploading" ? "Uploading…" : i.doc?.duplicate ? "Already uploaded before" : formatBytes(i.file.size))}
                      </p>
                    </div>
                    {i.state === "uploading" && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Uploading" />}
                    {i.state === "uploaded" && <CheckCircle2 className="size-4 text-success" aria-label="Uploaded" />}
                    {i.state === "error" && (
                      <>
                        <XCircle className="size-4 text-destructive" aria-hidden />
                        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${i.file.name}`} onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))}>
                          <X />
                        </Button>
                      </>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>

            {uploaded.length > 0 && (
              <>
                <TypeChooser schemas={schemas} value={schemaId} suggested={suggested} onChange={setSchemaId} onNavigate={close} />
                <ModeChooser status={aiStatus} value={mode} onChange={setMode} />
              </>
            )}
          </>
        )}

        <DialogFooter className="gap-2">
          {step === "type" && !busy && (
            <Button variant="ghost" className="sm:mr-auto" onClick={() => setItems([])} disabled={uploading}>
              <ArrowLeft /> Other file
            </Button>
          )}
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {step === "type" && (
            <Button onClick={start} disabled={!uploaded.length || !schemaId || busy || uploading}>
              {busy && <Loader2 className="animate-spin" />}
              Extract information
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Steps({ step }: { step: "file" | "type" }) {
  const steps = ["Upload", "Choose type", "Review & download"]
  const current = step === "file" ? 0 : 1
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full font-mono text-[11px]",
              i < current ? "bg-success/15 text-success" : i === current ? "bg-highlight font-semibold text-highlight-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === current ? "font-medium" : "hidden text-muted-foreground sm:inline")}>{s}</span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-border sm:w-6" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}
