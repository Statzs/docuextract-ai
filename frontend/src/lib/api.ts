// Typed client for the FastAPI backend. Auth is an HttpOnly cookie, so no token handling here.

export type FieldType = "string" | "number" | "currency" | "date" | "boolean"
export type DocStatus = "queued" | "processing" | "needs_review" | "validated" | "failed"
export type FieldValue = string | number | boolean | null

export interface User { id: string; email: string; name: string; is_demo: boolean }

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  description: string
}

export interface ExtractionSchema {
  id: string
  name: string
  description: string
  fields: FieldDef[]
  created_at: string
  updated_at: string
  document_count: number
}

export interface DocumentSummary {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  page_count: number | null
  status: DocStatus
  error: string | null
  attempts: number
  provider: string | null
  model: string | null
  notes: string | null
  schema_id: string | null
  schema_name: string
  created_at: string
  processed_at: string | null
  validated_at: string | null
}

export interface DocumentDetail extends DocumentSummary {
  schema_snapshot: FieldDef[]
  extracted_data: Record<string, { value: FieldValue; confidence: number }> | null
  reviewed_data: Record<string, FieldValue> | null
}

export interface DocumentPage { items: DocumentSummary[]; total: number; page: number; page_size: number }

export interface UsageSummary {
  days: number
  total_requests: number
  failed_requests: number
  input_tokens: number
  output_tokens: number
  avg_latency_ms: number
  estimated: boolean
  series: { date: string; requests: number; failures: number; input_tokens: number; output_tokens: number }[]
  status_counts: Partial<Record<DocStatus, number>>
}

export interface AppConfig {
  demo_mode: boolean
  provider: string
  model: string
  max_upload_mb: number
  accepted_types: string[]
  password_reset_enabled: boolean
}

export class ApiError extends Error {
  status: number
  fields: Record<string, string>

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

function messageFrom(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown })?.detail
  if (typeof detail === "string") return new ApiError(status, detail)
  if (Array.isArray(detail)) {
    // FastAPI/Pydantic validation errors: [{loc: [...], msg}]
    const fields: Record<string, string> = {}
    for (const d of detail as { loc: (string | number)[]; msg: string }[]) {
      fields[String(d.loc.at(-1))] = d.msg.replace(/^Value error, /, "")
    }
    return new ApiError(status, Object.values(fields)[0] ?? "Invalid request.", fields)
  }
  if (detail && typeof detail === "object") {
    const d = detail as { message?: string; fields?: Record<string, string> }
    return new ApiError(status, d.message ?? "Request failed.", d.fields ?? {})
  }
  if (status >= 500) return new ApiError(status, "Something went wrong on our side. Please try again.")
  return new ApiError(status, "Request failed.")
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...init,
      headers: isForm || !init.body ? init.headers : { "Content-Type": "application/json", ...init.headers },
    })
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.")
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw messageFrom(res.status, body)
  return body as T
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
})

export const api = {
  config: () => request<AppConfig>("/config"),
  me: () => request<User>("/auth/me"),
  login: (email: string, password: string) => request<User>("/auth/login", json("POST", { email, password })),
  register: (name: string, email: string, password: string) =>
    request<User>("/auth/register", json("POST", { name, email, password })),
  demo: () => request<User>("/auth/demo", json("POST")),
  logout: () => request<void>("/auth/logout", json("POST")),
  forgotPassword: (email: string) => request<{ message: string }>("/auth/forgot-password", json("POST", { email })),
  resetPassword: (token: string, password: string) =>
    request<void>("/auth/reset-password", json("POST", { token, password })),

  samples: () => request<{ filename: string; schema: string }[]>("/samples"),
  sampleFile: async (filename: string) => {
    const res = await fetch(`/api/samples/${encodeURIComponent(filename)}`, { credentials: "same-origin" })
    if (!res.ok) throw new ApiError(res.status, "Could not load the sample.")
    return new File([await res.blob()], filename, { type: "application/pdf" })
  },

  schemas: () => request<ExtractionSchema[]>("/schemas"),
  createSchema: (s: SchemaInput) => request<ExtractionSchema>("/schemas", json("POST", s)),
  updateSchema: (id: string, s: SchemaInput) => request<ExtractionSchema>(`/schemas/${id}`, json("PUT", s)),
  deleteSchema: (id: string) => request<void>(`/schemas/${id}`, json("DELETE")),

  documents: (params: { q?: string; status?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v))
    return request<DocumentPage>(`/documents?${qs}`)
  },
  document: (id: string) => request<DocumentDetail>(`/documents/${id}`),
  upload: (file: File, schemaId: string) => {
    const form = new FormData()
    form.append("file", file)
    form.append("schema_id", schemaId)
    return request<DocumentDetail>("/documents", { method: "POST", body: form })
  },
  review: (id: string, values: Record<string, FieldValue>, validate: boolean) =>
    request<DocumentDetail>(`/documents/${id}/review`, json("PATCH", { values, validate })),
  retry: (id: string) => request<DocumentDetail>(`/documents/${id}/retry`, json("POST")),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, json("DELETE")),
  fileUrl: (id: string) => `/api/documents/${id}/file`,
  exportUrl: (format: "csv" | "xlsx" | "json", ids?: string[]) =>
    `/api/documents/export?format=${format}${ids?.length ? `&ids=${ids.join(",")}` : ""}`,

  usage: (days: number) => request<UsageSummary>(`/usage?days=${days}`),
}

export type SchemaInput = Pick<ExtractionSchema, "name" | "description" | "fields">
