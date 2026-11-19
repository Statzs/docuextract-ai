import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, ApiError, type DocStatus, type ExtractMode, type FieldValue, type SchemaInput } from "@/lib/api"

const ACTIVE: DocStatus[] = ["queued", "processing"]

export const keys = {
  me: ["me"] as const,
  config: ["config"] as const,
  schemas: ["schemas"] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["documents", "detail", id] as const,
  usage: (days: number) => ["usage", days] as const,
  aiStatus: ["ai-status"] as const,
  admin: ["admin"] as const,
}

const toastError = (e: Error) => toast.error(e.message)

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.me()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })
}

export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: 5 * 60_000 })
export const useSchemas = () => useQuery({ queryKey: keys.schemas, queryFn: api.schemas })
export const useAiStatus = (enabled = true) =>
  useQuery({ queryKey: keys.aiStatus, queryFn: api.aiStatus, enabled, staleTime: 30_000 })

export function useDocuments(params: { q?: string; status?: string; page?: number; page_size?: number }) {
  return useQuery({
    queryKey: [...keys.documents, "list", params],
    queryFn: () => api.documents(params),
    placeholderData: keepPreviousData,
    // Poll only while something on screen is still being processed.
    refetchInterval: (q) => (q.state.data?.items.some((d) => ACTIVE.includes(d.status)) ? 1500 : false),
  })
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: keys.document(id),
    queryFn: () => api.document(id),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 1200 : false),
  })
}

export const useUsage = (days: number) =>
  useQuery({ queryKey: keys.usage(days), queryFn: () => api.usage(days), placeholderData: keepPreviousData })

export function useUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, schemaId, mode }: { file: File; schemaId?: string; mode?: ExtractMode }) =>
      api.upload(file, schemaId, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.documents })
      qc.invalidateQueries({ queryKey: ["usage"] })
    },
  })
}

export function useExtract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, schemaId, mode }: { id: string; schemaId: string; mode: ExtractMode }) => api.extract(id, schemaId, mode),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(doc.id), doc)
      qc.invalidateQueries({ queryKey: keys.documents })
      qc.invalidateQueries({ queryKey: keys.aiStatus })
      qc.invalidateQueries({ queryKey: ["usage"] })
    },
  })
}

export function useReview(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ values, validate }: { values: Record<string, FieldValue>; validate: boolean }) =>
      api.review(id, values, validate),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc)
      qc.invalidateQueries({ queryKey: [...keys.documents, "list"] })
    },
  })
}

export function useRetry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.retry,
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(doc.id), doc)
      qc.invalidateQueries({ queryKey: keys.documents })
      toast.success("Extraction restarted")
    },
    onError: toastError,
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.documents })
      toast.success("Document deleted")
    },
    onError: toastError,
  })
}

export function useSaveSchema() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: SchemaInput }) =>
      id ? api.updateSchema(id, data) : api.createSchema(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.schemas }),
  })
}

export function useDeleteSchema() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteSchema,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.schemas })
      toast.success("Template deleted")
    },
    onError: toastError,
  })
}

export const useAdminOverview = () => useQuery({ queryKey: keys.admin, queryFn: api.adminOverview, refetchInterval: 30_000 })

export function useAdminLimits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.adminSetLimits,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.admin })
      qc.invalidateQueries({ queryKey: keys.config })
      qc.invalidateQueries({ queryKey: keys.aiStatus })
      toast.success("Limits saved")
    },
    onError: toastError,
  })
}
