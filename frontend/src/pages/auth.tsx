import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
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
          Define the fields you need, let Gemini read the document, then review every value side by side with the
          original before exporting.
        </p>
      </div>
    </div>
  )
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState<"form" | "demo" | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const isLogin = mode === "login"
  const resetEnabled = useConfig().data?.password_reset_enabled

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
      done(isLogin ? await api.login(email, password) : await api.register(String(f.get("name")), email, password))
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
          <Logo />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-3xl font-semibold tracking-tight">{isLogin ? "Welcome back" : "Create your workspace"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? "Sign in to review and export your extractions." : "Start extracting structured data from documents."}
            </p>

            <Button variant="outline" size="lg" className="mt-8 w-full" onClick={demo} disabled={pending !== null}>
              {pending === "demo" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Explore the demo — no signup
            </Button>

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or with email <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="grid gap-4" noValidate={false}>
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
