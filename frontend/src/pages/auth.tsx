import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { ArrowRight, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Logo } from "@/components/common"
import { ThemeToggle } from "@/components/theme"
import { api, ApiError, type User } from "@/lib/api"
import { keys, useConfig } from "@/lib/queries"

const SAMPLE = [
  { label: "Invoice Number", value: "HR-2026-0142", conf: 0.98 },
  { label: "Vendor", value: "Halden & Roe Studio", conf: 0.97 },
  { label: "Issue Date", value: "2026-10-02", conf: 0.95 },
  { label: "Total", value: "3,834.00", conf: 0.93 },
]

function Showcase() {
  return (
    <div className="relative hidden overflow-hidden border-l bg-surface lg:flex lg:flex-col lg:justify-center lg:px-14">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="relative mx-auto w-full max-w-md">
        <p className="mb-6 font-mono text-xs tracking-wider text-muted-foreground uppercase">Document → structured data</p>
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 12, rotate: -1.5 }}
            animate={{ opacity: 1, y: 0, rotate: -1.5 }}
            transition={{ duration: 0.5 }}
            className="rounded-xl border bg-card p-6 shadow-sm"
            aria-hidden
          >
            <p className="text-lg font-semibold tracking-tight">INVOICE</p>
            <p className="text-xs text-muted-foreground">Halden &amp; Roe Studio · 48 Quarry Lane</p>
            <div className="mt-5 space-y-2 text-sm">
              {SAMPLE.map((f, i) => (
                <p key={f.label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{f.label}</span>
                  <motion.span
                    initial={{ backgroundSize: "0% 62%" }}
                    animate={{ backgroundSize: "100% 62%" }}
                    transition={{ delay: 0.5 + i * 0.25, duration: 0.45 }}
                    className="marker font-mono text-[13px]"
                  >
                    {f.value}
                  </motion.span>
                </p>
              ))}
              <div className="space-y-1.5 pt-3">
                <div className="h-1.5 w-full rounded bg-muted" />
                <div className="h-1.5 w-4/5 rounded bg-muted" />
                <div className="h-1.5 w-2/3 rounded bg-muted" />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.6, duration: 0.5 }}
            className="relative -mt-6 ml-10 rounded-xl border bg-popover p-4 font-mono text-[12px] leading-relaxed shadow-lg"
            aria-hidden
          >
            <span className="text-muted-foreground">{"{"}</span>
            {SAMPLE.map((f) => (
              <div key={f.label} className="flex justify-between gap-3 pl-4">
                <span>
                  <span className="text-info">"{f.label.toLowerCase().replace(/ /g, "_")}"</span>: "{f.value}"
                </span>
                <span className="text-success">{Math.round(f.conf * 100)}%</span>
              </div>
            ))}
            <span className="text-muted-foreground">{"}"}</span>
          </motion.div>
        </div>
        <p className="mt-10 max-w-sm text-sm text-muted-foreground">
          Upload an invoice, receipt or contract, choose its type, and get the key information as a spreadsheet. You check
          every value next to the original before downloading.
        </p>
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c1-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  )
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [pending, setPending] = useState<"form" | "demo" | null>(null)
  const [error, setError] = useState<ApiError | null>(
    params.get("error") === "oauth"
      ? new ApiError(400, "We couldn't sign you in with that account. Make sure its email address is verified, or try another method.")
      : null,
  )
  const isLogin = mode === "login"
  const { data: config } = useConfig()
  const resetEnabled = config?.password_reset_enabled
  const oauth = [
    ...(config?.google_enabled ? [{ id: "google" as const, label: "Continue with Google", icon: <GoogleMark /> }] : []),
    ...(config?.github_enabled ? [{ id: "github" as const, label: "Continue with GitHub", icon: <GitHubMark /> }] : []),
  ]

  function done(user: User) {
    qc.clear()
    qc.setQueryData(keys.me, user)
    navigate("/app")
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get("email"))
    const password = String(f.get("password"))
    setPending("form")
    setError(null)
    try {
      done(
        isLogin
          ? await api.login(email, password)
          : await api.register(String(f.get("name")), email, password, String(f.get("website") ?? "")),
      )
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setPending(null)
    }
  }

  async function demo() {
    setPending("demo")
    setError(null)
    try {
      done(await api.demo())
    } catch (err) {
      setError(err as ApiError)
      setPending(null)
    }
  }

  const fieldError = (k: string) => error?.fields?.[k]

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="DocuExtract AI home"><Logo /></Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-3xl font-semibold tracking-tight">{isLogin ? "Welcome back" : "Create your free account"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? "Sign in to see your documents." : "One click with Google or GitHub, or use your email."}
            </p>

            <div className="mt-8 grid gap-2">
              {oauth.map((o) => (
                <Button key={o.id} size="lg" variant="outline" className="w-full" render={<a href={api.oauthUrl(o.id)} />} nativeButton={false}>
                  {o.icon} {o.label}
                </Button>
              ))}
              <Button variant={oauth.length ? "ghost" : "outline"} size="lg" className="w-full" onClick={demo} disabled={pending !== null}>
                {pending === "demo" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Try the demo — no signup
              </Button>
            </div>

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or with email <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="grid gap-4" noValidate={false}>
              {!isLogin && (
                // Honeypot: hidden from people and screen readers; bots that fill every field are refused.
                <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                  <label htmlFor="website">Website</label>
                  <input id="website" name="website" tabIndex={-1} autoComplete="off" />
                </div>
              )}
              {!isLogin && (
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" autoComplete="name" required maxLength={120} aria-invalid={!!fieldError("name")} />
                  {fieldError("name") && <p className="text-xs text-destructive">{fieldError("name")}</p>}
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!fieldError("email")} />
                {fieldError("email") && <p className="text-xs text-destructive">{fieldError("email")}</p>}
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="password">Password</Label>
                  {isLogin && resetEnabled && (
                    <Link to="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={isLogin ? undefined : 8}
                  maxLength={128}
                  aria-invalid={!!fieldError("password")}
                />
                {!isLogin && !fieldError("password") && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
                {fieldError("password") && <p className="text-xs text-destructive">{fieldError("password")}</p>}
              </div>
              {error && !Object.keys(error.fields).length && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error.message}
                </p>
              )}
              <Button type="submit" size="lg" disabled={pending !== null}>
                {pending === "form" && <Loader2 className="animate-spin" />}
                {isLogin ? "Sign in" : "Create account"} <ArrowRight />
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {isLogin ? "New here? " : "Already have an account? "}
              <Link to={isLogin ? "/register" : "/login"} className="font-medium text-foreground underline-offset-4 hover:underline">
                {isLogin ? "Create an account" : "Sign in"}
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
      <Showcase />
    </div>
  )
}
