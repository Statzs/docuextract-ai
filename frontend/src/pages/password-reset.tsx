import { useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { motion } from "motion/react"
import { ArrowLeft, Loader2, MailCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Logo } from "@/components/common"
import { ThemeToggle } from "@/components/theme"
import { api, ApiError } from "@/lib/api"

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-12">
      <div className="flex items-center justify-between">
        <Logo />
        <ThemeToggle />
      </div>
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12"
      >
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-8">{children}</div>
        <Link
          to="/login"
          className="mt-6 inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to sign in
        </Link>
      </motion.main>
    </div>
  )
}

function FormError({ error }: { error: ApiError | null }) {
  if (!error) return null
  const msg = Object.values(error.fields)[0] ?? error.message
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {msg}
    </p>
  )
}

export function ForgotPasswordPage() {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api.forgotPassword(String(new FormData(e.currentTarget).get("email")))
      setSent(true)
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setPending(false)
    }
  }

  if (sent)
    return (
      <Shell title="Check your inbox" subtitle="If an account exists for that email, we sent a link to reset the password.">
        <div className="flex items-start gap-3 rounded-lg border bg-surface p-4 text-sm">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <p className="text-muted-foreground">The link works once and expires in 30 minutes. Check spam if it does not arrive.</p>
        </div>
      </Shell>
    )

  return (
    <Shell title="Reset your password" subtitle="Enter the email you signed up with and we'll send you a reset link.">
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <FormError error={error} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Send reset link
        </Button>
      </form>
    </Shell>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (f.get("password") !== f.get("confirm")) {
      setError(new ApiError(422, "Passwords do not match.", {}))
      return
    }
    setPending(true)
    setError(null)
    try {
      await api.resetPassword(token, String(f.get("password")))
      toast.success("Password updated. Sign in with your new password.")
      navigate("/login", { replace: true })
    } catch (err) {
      setError(err as ApiError)
      setPending(false)
    }
  }

  if (!token)
    return (
      <Shell title="Link incomplete" subtitle="This reset link is missing its token. Request a new one.">
        <Button render={<Link to="/forgot-password" />} nativeButton={false} size="lg" className="w-full">
          Request a new link
        </Button>
      </Shell>
    )

  return (
    <Shell title="Choose a new password" subtitle="You'll be signed out of every other session.">
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        </div>
        <FormError error={error} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Update password
        </Button>
      </form>
    </Shell>
  )
}
