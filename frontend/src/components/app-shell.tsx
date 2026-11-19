import { useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { Activity, Braces, FileStack, Gauge, LayoutGrid, LogOut, Menu, Plus, Sparkles, UserX } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Logo } from "@/components/common"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ThemeToggle } from "@/components/theme"
import { UploadDialog } from "@/components/upload-dialog"
import { api, type User } from "@/lib/api"
import { useConfig } from "@/lib/queries"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/app", label: "Home", icon: LayoutGrid, end: true },
  { to: "/app/documents", label: "My documents", icon: FileStack },
]
// Optional, for people who want to tune what gets extracted or watch consumption.
const ADVANCED = [
  { to: "/app/schemas", label: "Templates", icon: Braces },
  { to: "/app/usage", label: "Usage", icon: Activity },
]

function Nav({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin: boolean }) {
  const groups = [
    { label: null, items: NAV },
    { label: "Advanced", items: ADVANCED },
    ...(isAdmin ? [{ label: "Owner", items: [{ to: "/app/admin", label: "Admin panel", icon: Gauge }] }] : []),
  ]
  return (
    <nav className="grid gap-4" aria-label="Main">
      {groups.map((g) => (
        <div key={g.label ?? "main"} className="grid gap-0.5">
          {g.label && <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</p>}
          <NavItems items={g.items} onNavigate={onNavigate} />
        </div>
      ))}
    </nav>
  )
}

function NavItems({ items, onNavigate }: { items: { to: string; label: string; icon: typeof Gauge; end?: boolean }[]; onNavigate?: () => void }) {
  return (
    <>
      {items.map((n) => (
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
    </>
  )
}

function UserFooter({ user }: { user: User }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  async function logout() {
    await api.logout().catch(() => undefined)
    qc.clear()
    navigate("/")
  }
  async function deleteAccount() {
    try {
      await api.deleteAccount()
      qc.clear()
      toast.success("Your account and all its documents were deleted.")
      navigate("/")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <div className="flex items-center gap-1.5 border-t border-sidebar-border pt-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium uppercase">
        {user.name.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.is_demo ? "Demo workspace" : user.email}</p>
      </div>
      <ThemeToggle />
      {!user.is_demo && (
        <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} aria-label="Delete my account" title="Delete my account">
          <UserX />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Log out" title="Log out">
        <LogOut />
      </Button>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your account?"
        description="Your account, every uploaded file and all extracted data are permanently deleted. This cannot be undone."
        confirmLabel="Delete everything"
        onConfirm={deleteAccount}
      />
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
        <Plus /> Extract a document
      </Button>
      <Nav onNavigate={onNavigate} isAdmin={user.is_admin} />
      <div className="mt-auto grid gap-3">
        {(user.is_demo || config?.demo_mode) && (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
              <Sparkles className="size-3.5 text-highlight-foreground dark:text-highlight" />
              {user.is_demo ? "Demo workspace" : "Standard reading"}
            </p>
            {user.is_demo
              ? "Fictional documents, deleted after 24 hours. Demo extractions use text reading and OCR, never AI."
              : "AI is not set up on this server: documents are read with text recognition and OCR."}
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
        <Button size="icon-sm" aria-label="Extract a document" onClick={() => setUploadOpen(true)}>
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
