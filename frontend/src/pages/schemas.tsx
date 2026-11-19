import { useState, type FormEvent } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowDown, ArrowUp, Braces, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, ErrorState, PageHeader } from "@/components/common"
import { ConfirmDialog } from "@/components/confirm-dialog"
import type { ApiError, ExtractionSchema, FieldDef, FieldType } from "@/lib/api"
import { useDeleteSchema, useSaveSchema, useSchemas } from "@/lib/queries"
import { timeAgo } from "@/lib/format"

const TYPES: { value: FieldType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
]

export const toKey = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40)

type Draft = FieldDef & { _id: string; _keyTouched: boolean }
const blankField = (): Draft => ({ _id: crypto.randomUUID(), _keyTouched: false, key: "", label: "", type: "string", required: false, description: "" })

function SchemaEditor({ schema, open, onOpenChange }: { schema: ExtractionSchema | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveSchema()
  const [name, setName] = useState(schema?.name ?? "")
  const [description, setDescription] = useState(schema?.description ?? "")
  const [fields, setFields] = useState<Draft[]>(
    schema ? schema.fields.map((f) => ({ ...f, _id: crypto.randomUUID(), _keyTouched: true })) : [blankField()],
  )
  const [error, setError] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Draft>) =>
    setFields((fs) =>
      fs.map((f) => {
        if (f._id !== id) return f
        const next = { ...f, ...patch }
        if (patch.label !== undefined && !f._keyTouched) next.key = toKey(patch.label)
        return next
      }),
    )
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const n = [...fs]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const keys = fields.map((f) => f.key)
    if (keys.some((k) => !/^[a-z][a-z0-9_]{0,39}$/.test(k))) return setError("Every field needs a label and a valid key (snake_case, starting with a letter).")
    if (new Set(keys).size !== keys.length) return setError("Field keys must be unique.")
    try {
      await save.mutateAsync({
        id: schema?.id,
        data: { name: name.trim(), description: description.trim(), fields: fields.map(({ _id, _keyTouched, ...f }) => f) },
      })
      toast.success(schema ? "Template updated" : "Template created")
      onOpenChange(false)
    } catch (err) {
      setError((err as ApiError).message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <form onSubmit={submit} className="flex h-full flex-col">
          <SheetHeader className="border-b p-5">
            <SheetTitle>{schema ? "Edit template" : "New template"}</SheetTitle>
            <SheetDescription>
              Fields are the pieces of information to look for. Descriptions help the AI understand each one. Documents already
              extracted keep the fields they were read with.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="grid gap-1.5">
              <Label htmlFor="schema-name">Name</Label>
              <Input id="schema-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Delivery note" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="schema-desc">Description</Label>
              <Textarea id="schema-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Fields</Label>
                <span className="text-xs text-muted-foreground">{fields.length} / 40</span>
              </div>
              <AnimatePresence initial={false}>
                {fields.map((f, i) => (
                  <motion.div
                    key={f._id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-2.5 rounded-lg border bg-surface/60 p-3"
                  >
                    <div className="flex gap-2">
                      <Input aria-label={`Field ${i + 1} label`} value={f.label} onChange={(e) => update(f._id, { label: e.target.value })} placeholder="Label" required maxLength={60} />
                      <Select items={TYPES} value={f.type} onValueChange={(v) => update(f._id, { type: v as FieldType })}>
                        <SelectTrigger className="w-32 shrink-0" aria-label={`Field ${i + 1} type`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label={`Field ${i + 1} key`}
                        value={f.key}
                        onChange={(e) => update(f._id, { key: e.target.value, _keyTouched: true })}
                        className="h-7 w-44 font-mono text-xs"
                        placeholder="field_key"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch size="sm" checked={f.required} onCheckedChange={(c) => update(f._id, { required: c })} /> Required
                      </label>
                      <div className="ml-auto flex">
                        <Button type="button" variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                          <ArrowUp />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-xs" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={fields.length === 1}
                          onClick={() => setFields((fs) => fs.filter((x) => x._id !== f._id))}
                          aria-label={`Remove field ${f.label || i + 1}`}
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                    <Input
                      aria-label={`Field ${i + 1} hint`}
                      value={f.description}
                      onChange={(e) => update(f._id, { description: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="Hint for the model (optional)"
                      maxLength={300}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={fields.length >= 40} onClick={() => setFields((fs) => [...fs, blankField()])}>
                <Plus /> Add field
              </Button>
            </div>
          </div>
          <SheetFooter className="border-t p-4">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />}
                {schema ? "Save changes" : "Create template"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

export function SchemasPage() {
  const { data: schemas, isLoading, error, refetch } = useSchemas()
  const del = useDeleteSchema()
  const [editing, setEditing] = useState<{ schema: ExtractionSchema | null; n: number } | null>(null)
  const [toDelete, setToDelete] = useState<ExtractionSchema | null>(null)
  const openNew = () => setEditing({ schema: null, n: Date.now() })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description="Advanced: the list of fields looked for in each kind of document. Edit a built-in template or create your own for a custom extraction."
        actions={
          <Button onClick={openNew}>
            <Plus /> New template
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : !schemas?.length ? (
        <EmptyState icon={Braces} title="No templates yet" description="Create a template to tell the extractor which fields to look for." action={<Button onClick={openNew}>Create a template</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {schemas.map((s, i) => (
            <motion.article
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group flex flex-col rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-medium">{s.name}</h3>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{s.description || "No description"}</p>
                </div>
                <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ schema: s, n: Date.now() })}>
                    <Pencil />
                  </Button>
                  {!s.kind && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${s.name}`} onClick={() => setToDelete(s)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                {s.fields.slice(0, 6).map((f) => (
                  <span key={f.key} className="rounded-md border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {f.key}
                  </span>
                ))}
                {s.fields.length > 6 && <span className="px-1 py-0.5 text-[11px] text-muted-foreground">+{s.fields.length - 6} more</span>}
              </div>
              <p className="mt-auto pt-4 text-xs text-muted-foreground">
                {s.fields.length} fields · {s.document_count} documents · updated {timeAgo(s.updated_at)}
              </p>
            </motion.article>
          ))}
        </div>
      )}
      {editing && (
        <SchemaEditor key={editing.n} schema={editing.schema} open onOpenChange={(o) => !o && setEditing(null)} />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete "${toDelete?.name}"?`}
        description="Documents already extracted with this template keep their data."
        onConfirm={() => {
          if (toDelete) del.mutate(toDelete.id)
          setToDelete(null)
        }}
      />
    </div>
  )
}
