import { useEffect, useState } from "react"
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router"
import { ChevronLeft, ChevronRight, FileSearch, FileStack, MoreHorizontal, Plus, RotateCw, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, PageHeader, StatusBadge } from "@/components/common"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ExportMenu } from "@/components/export-menu"
import type { ShellContext } from "@/components/app-shell"
import type { DocStatus } from "@/lib/api"
import { useDeleteDocument, useDocuments, useRetry } from "@/lib/queries"
import { formatBytes, formatDate, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

const FILTERS: { id: string; label: string; status?: DocStatus[] }[] = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review", status: ["needs_review"] },
  { id: "validated", label: "Validated", status: ["validated"] },
  { id: "active", label: "In progress", status: ["queued", "processing"] },
  { id: "failed", label: "Failed", status: ["failed"] },
]
const PAGE_SIZE = 15

export function DocumentsPage() {
  const { openUpload } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.find((f) => f.id === params.get("filter")) ?? FILTERS[0]
  const page = Math.max(1, Number(params.get("page")) || 1)
  const [search, setSearch] = useState(params.get("q") ?? "")
  const [q, setQ] = useState(search)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toDelete, setToDelete] = useState<{ id: string; filename: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const docs = useDocuments({ q, status: filter.status?.join(","), page, page_size: PAGE_SIZE })
  const del = useDeleteDocument()
  const retry = useRetry()
  const items = docs.data?.items ?? []
  const pages = Math.max(1, Math.ceil((docs.data?.total ?? 0) / PAGE_SIZE))

  const setParam = (k: string, v: string | null) =>
    setParams((p) => {
      if (v) p.set(k, v)
      else p.delete(k)
      if (k !== "page") p.delete("page")
      return p
    })

  const allSelected = items.length > 0 && items.every((d) => selected.has(d.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((d) => d.id)))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Every document you have processed, with its extraction status."
        actions={
          <>
            <ExportMenu ids={selected.size ? [...selected] : undefined} label={selected.size ? `Export ${selected.size}` : "Export all"} />
            <Button onClick={openUpload}>
              <Plus /> Upload
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:pb-0" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={f.id === filter.id}
              onClick={() => setParam("filter", f.id === "all" ? null : f.id)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                f.id === filter.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename"
            aria-label="Search documents"
            className="pl-8"
            maxLength={100}
          />
        </div>
      </div>

      {docs.error ? (
        <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
      ) : !docs.isLoading && items.length === 0 ? (
        q || filter.status ? (
          <EmptyState icon={FileSearch} title="No matches" description="No documents match these filters. Try a different search or status." />
        ) : (
          <EmptyState
            icon={FileStack}
            title="Your document history is empty"
            description="Uploaded documents appear here with their status, schema and extracted data."
            action={<Button onClick={openUpload}>Upload your first document</Button>}
          />
        )
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all on this page" />
                  </TableHead>
                  <TableHead>File</TableHead>
                  <TableHead className="hidden sm:table-cell">Schema</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.isLoading
                  ? Array.from({ length: 6 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6} className="px-4">
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((d) => (
                      <TableRow
                        key={d.id}
                        data-state={selected.has(d.id) ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => navigate(`/app/documents/${d.id}`)}
                      >
                        <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label={`Select ${d.filename}`} />
                        </TableCell>
                        <TableCell className="max-w-[11rem] sm:max-w-[18rem]">
                          <Link to={`/app/documents/${d.id}`} className="block truncate font-medium" onClick={(e) => e.stopPropagation()}>
                            {d.filename}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(d.size_bytes)}
                            {d.page_count ? ` · ${d.page_count} ${d.page_count === 1 ? "page" : "pages"}` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">{d.schema_name}</TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} />
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell" title={formatDate(d.created_at)}>
                          {timeAgo(d.created_at)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.filename}`} />}>
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={d.status === "queued" || d.status === "processing"}
                                onClick={() => retry.mutate(d.id)}
                              >
                                <RotateCw /> Re-run extraction
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setToDelete(d)}>
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
              <span>
                Page {page} of {pages} · {docs.data?.total} documents
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this document?"
        description={`"${toDelete?.filename}" and its extracted data will be permanently removed. This cannot be undone.`}
        onConfirm={() => {
          if (toDelete) del.mutate(toDelete.id)
          setToDelete(null)
        }}
      />
    </div>
  )
}
