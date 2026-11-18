import { useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { Activity, Braces, FileStack, LayoutGrid, LogOut, Menu, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Logo } from "@/components/common"
import { ThemeToggle } from "@/components/theme"
import { UploadDialog } from "@/components/upload-dialog"
import { api, type User } from "@/lib/api"
import { useConfig } from "@/lib/queries"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/app/documents", label: "Documents", icon: FileStack },
  { to: "/app/schemas", label: "Schemas", icon: Braces },
  { to: "/app/usage", label: "API usage", icon: Activity },
]

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="grid gap-0.5" aria-label="Main">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
              isActive ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="nav-indicator" className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-highlight" />}
              <n.icon className="size-4" />
              {n.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function UserFooter({ user }: { user: User }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  async function logout() {
    await api.logout().catch(() => undefined)
    qc.clear()
    navigate("/login")
  }
  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border pt-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium uppercase">
        {user.name.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.is_demo ? "Demo workspace" : user.email}</p>
      </div>
      <ThemeToggle />
      <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Log out" title="Log out">
        <LogOut />
      </Button>
    </div>
  )
}

export function AppShell({ user }: { user: User }) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { data: config } = useConfig()
  const location = useLocation()

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-5 p-3">
      <div className="px-1.5 pt-1.5">
        <Logo />
      </div>
      <Button
        className="w-full justify-start"
        onClick={() => {
          onNavigate?.()
          setUploadOpen(true)
        }}
      >
        <Plus /> New extraction
      </Button>
      <Nav onNavigate={onNavigate} />
      <div className="mt-auto grid gap-3">
        {config?.demo_mode && (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
              <Sparkles className="size-3.5 text-highlight-foreground dark:text-highlight" /> Offline demo mode
            </p>
            No Gemini key is configured, so extraction uses the built-in text matcher. Images need Gemini.
          </div>
        )}
        <UserFooter user={user} />
      </div>
    </div>
  )

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block">{sidebar()}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon-sm" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
          <Menu />
        </Button>
        <Logo />
        <Button size="icon-sm" aria-label="New extraction" onClick={() => setUploadOpen(true)}>
          <Plus />
        </Button>
      </header>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar(() => setMenuOpen(false))}
        </SheetContent>
      </Sheet>

      <main className="lg:pl-60">
        {/* Enter-only transition: an exit animation would render the new route inside the
            leaving wrapper and then remount it, discarding state (e.g. a form being edited). */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10"
        >
          <Outlet context={{ openUpload: () => setUploadOpen(true) }} />
        </motion.div>
      </main>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}

export type ShellContext = { openUpload: () => void }
