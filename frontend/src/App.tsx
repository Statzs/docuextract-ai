import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useNavigate } from "react-router"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell"
import { ErrorState, Logo } from "@/components/common"
import { AuthPage } from "@/pages/auth"
import { keys, useMe } from "@/lib/queries"
import { api } from "@/lib/api"

function FullScreenLoader() {
  // Free-tier API hosts sleep when idle; the first request can take up to a minute.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center" aria-busy>
      <div className="flex flex-col items-center gap-3" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        {slow && (
          <p className="max-w-xs text-sm text-muted-foreground">
            Waking up the server. The free hosting tier sleeps when idle, so this can take up to a minute.
          </p>
        )}
      </div>
    </div>
  )
}

function RequireAuth() {
  const { data: user, isLoading, error, refetch } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (error) return <div className="mx-auto max-w-md p-10"><ErrorState error={error} onRetry={() => refetch()} /></div>
  if (!user) return <Navigate to="/login" replace />
  return <AppShell user={user} />
}

function GuestOnly() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  return user ? <Navigate to="/app" replace /> : <Outlet />
}

/** `/demo`: a one-click entry for shared links. Creates a throwaway workspace and opens it. */
function StartDemo() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<Error | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice in development
    started.current = true
    api
      .demo()
      .then((user) => {
        qc.clear()
        qc.setQueryData(keys.me, user)
        navigate("/app", { replace: true })
      })
      .catch(setError)
  }, [qc, navigate])
  if (error)
    return (
      <div className="mx-auto max-w-md p-10">
        <ErrorState error={error} onRetry={() => location.reload()} />
      </div>
    )
  return <FullScreenLoader />
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <Logo className="mb-8" />
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page doesn't exist</h1>
        <Button className="mt-6" render={<Link to="/" />} nativeButton={false}>
          Back to the home page
        </Button>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  { path: "/", lazy: () => import("@/pages/landing").then((m) => ({ Component: m.LandingPage })) },
  {
    element: <GuestOnly />,
    children: [
      { path: "/login", element: <AuthPage mode="login" /> },
      { path: "/register", element: <AuthPage mode="register" /> },
      { path: "/forgot-password", lazy: () => import("@/pages/password-reset").then((m) => ({ Component: m.ForgotPasswordPage })) },
    ],
  },
  // Outside GuestOnly: a reset link must work even in a browser that is still signed in.
  { path: "/reset-password", lazy: () => import("@/pages/password-reset").then((m) => ({ Component: m.ResetPasswordPage })) },
  {
    path: "/app",
    element: <RequireAuth />,
    children: [
      // Route-level code splitting: charts and editors load only when visited.
      { index: true, lazy: () => import("@/pages/dashboard").then((m) => ({ Component: m.DashboardPage })) },
      { path: "documents", lazy: () => import("@/pages/documents").then((m) => ({ Component: m.DocumentsPage })) },
      { path: "documents/:id", lazy: () => import("@/pages/document-detail").then((m) => ({ Component: m.DocumentDetailPage })) },
      { path: "schemas", lazy: () => import("@/pages/schemas").then((m) => ({ Component: m.SchemasPage })) },
      { path: "usage", lazy: () => import("@/pages/usage").then((m) => ({ Component: m.UsagePage })) },
      { path: "admin", lazy: () => import("@/pages/admin").then((m) => ({ Component: m.AdminPage })) },
    ],
  },
  { path: "/demo", element: <StartDemo /> },
  { path: "*", element: <NotFound /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
