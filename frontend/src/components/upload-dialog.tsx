import { useRef, useState, type DragEvent } from "react"
import { useNavigate } from "react-router"
import { AnimatePresence, motion } from "motion/react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, FileText, ImageIcon, Loader2, UploadCloud, X, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConfig, useSchemas, useUpload } from "@/lib/queries"
import { formatBytes } from "@/lib/format"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Item = { id: string; file: File; state: "ready" | "uploading" | "done" | "error"; error?: string; docId?: string }

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp"
const MIME_OK = ["application/pdf", "image/png", "image/jpeg", "image/webp"]

export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: schemas = [] } = useSchemas()
  const { data: config } = useConfig()
  const upload = useUpload()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [schemaId, setSchemaId] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: samples = [] } = useQuery({ queryKey: ["samples"], queryFn: api.samples, enabled: open, staleTime: Infinity })

  const maxMb = config?.max_upload_mb ?? 10
  const selectedSchema = schemaId ?? schemas[0]?.id ?? null

  function addFiles(files: FileList | null) {
    if (!files) return
    const next: Item[] = Array.from(files).map((file) => {
      // Client checks are for fast feedback only; the server re-validates by magic bytes.
      const error = !MIME_OK.includes(file.type)
        ? "Unsupported type"
        : file.size > maxMb * 1024 * 1024
          ? `Larger than ${maxMb} MB`
          : undefined
      return { id: crypto.randomUUID(), file, state: error ? "error" : "ready", error }
    })
    setItems((prev) => [...prev, ...next].slice(0, 20))
  }

  async function addSample(filename: string, schemaName: string) {
    try {
      const file = await api.sampleFile(filename)
      const match = schemas.find((s) => s.name === schemaName)
      if (match) setSchemaId(match.id)
      setItems([{ id: crypto.randomUUID(), file, state: "ready" }])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const patch = (id: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)))

  async function start() {
    if (!selectedSchema) return
    setBusy(true)
    const ready = items.filter((i) => i.state === "ready")
    let ok = 0
    let lastDoc: string | undefined
    for (const item of ready) {
      patch(item.id, { state: "uploading" })
      try {
        const doc = await upload.mutateAsync({ file: item.file, schemaId: selectedSchema })
        patch(item.id, { state: "done", docId: doc.id })
        ok++
        lastDoc = doc.id
      } catch (e) {
        patch(item.id, { state: "error", error: (e as Error).message })
      }
    }
    setBusy(false)
    if (ok) {
      toast.success(ok === 1 ? "Document uploaded — extracting now" : `${ok} documents uploaded — extracting now`)
      if (ok === ready.length) {
        close()
        navigate(ok === 1 && lastDoc ? `/app/documents/${lastDoc}` : "/app/documents")
      }
    }
  }

  function close() {
    onOpenChange(false)
    setTimeout(() => setItems([]), 200)
  }

  const readyCount = items.filter((i) => i.state === "ready").length

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !busy && close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            PDF, PNG, JPEG or WebP up to {maxMb} MB. Each file is extracted with the schema you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="schema-select">Extraction schema</Label>
          <Select
            items={schemas.map((s) => ({ value: s.id, label: s.name }))}
            value={selectedSchema}
            onValueChange={(v) => setSchemaId(v as string)}
          >
            <SelectTrigger id="schema-select" className="w-full">
              <SelectValue placeholder="Choose a schema" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">{s.fields.length} fields</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
            "group relative flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            dragging ? "border-foreground/40 bg-highlight/10" : "hover:bg-muted/50",
          )}
        >
          <motion.div animate={{ y: dragging ? -3 : 0 }} className="grid size-10 place-items-center rounded-lg border bg-card shadow-xs">
            <UploadCloud className="size-5 text-muted-foreground" />
          </motion.div>
          <p className="text-sm">
            <span className="font-medium">Drop files here</span> <span className="text-muted-foreground">or click to browse</span>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            data-testid="file-input"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ""
            }}
          />
        </button>

        {items.length === 0 && samples.length > 0 && (
          <div className="-mt-1">
            <p className="mb-2 text-xs text-muted-foreground">No document handy? Try a fictional sample:</p>
            <div className="flex flex-wrap gap-1.5">
              {samples.map((s) => (
                <Button key={s.filename} variant="outline" size="xs" onClick={() => addSample(s.filename, s.schema)}>
                  <FileText /> {s.filename.replace(/\.pdf$/, "")}
                </Button>
              ))}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <ul className="-mx-1 max-h-56 space-y-1 overflow-y-auto px-1">
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
                      {i.error ?? formatBytes(i.file.size)}
                    </p>
                  </div>
                  {i.state === "uploading" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  {i.state === "done" && <CheckCircle2 className="size-4 text-success" />}
                  {i.state === "error" && <XCircle className="size-4 text-destructive" />}
                  {i.state === "ready" && (
                    <Button variant="ghost" size="icon-xs" aria-label={`Remove ${i.file.name}`} onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))}>
                      <X />
                    </Button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={start} disabled={!readyCount || !selectedSchema || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {readyCount > 1 ? `Extract ${readyCount} files` : "Extract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
