import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"

const FORMATS = [
  { id: "csv", label: "CSV", hint: "Spreadsheets, BI tools" },
  { id: "xlsx", label: "Excel (.xlsx)", hint: "Microsoft Excel" },
  { id: "json", label: "JSON", hint: "APIs and scripts" },
] as const

/** Downloads go through plain links so the browser streams the file with the session cookie. */
export function ExportMenu({ ids, label = "Export", disabled }: { ids?: string[]; label?: string; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={disabled} />}>
        <Download /> {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.id} render={<a href={api.exportUrl(f.id, ids)} download />}>
            <div className="grid">
              <span>{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.hint}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
