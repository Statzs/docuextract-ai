import type { FieldType, FieldValue } from "@/lib/api"

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000], ["month", 2_592_000], ["week", 604_800],
  ["day", 86_400], ["hour", 3_600], ["minute", 60],
]

export function timeAgo(iso: string, now = Date.now()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return "just now"
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })

export const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n)

/** Display a typed extracted value. Never throws on unexpected shapes. */
export function displayValue(value: FieldValue, type: FieldType): string {
  if (value === null || value === undefined || value === "") return "—"
  if (type === "boolean" && typeof value === "boolean") return value ? "Yes" : "No"
  if ((type === "currency" || type === "number") && typeof value === "number") {
    return value.toLocaleString("en", { minimumFractionDigits: type === "currency" ? 2 : 0, maximumFractionDigits: 4 })
  }
  return String(value)
}

/** Convert a form input string back into the value sent to the API. */
export function parseInput(raw: string, type: FieldType): FieldValue {
  const s = raw.trim()
  if (s === "") return null
  if (type === "boolean") return s === "true"
  return s // the backend coerces and validates numbers/dates and reports field errors
}

export function toInput(value: FieldValue, type: FieldType): string {
  if (value === null || value === undefined) return ""
  if (type === "boolean") return value ? "true" : "false"
  if (type === "currency" && typeof value === "number") return value.toFixed(2)
  return String(value)
}
