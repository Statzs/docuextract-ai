import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

type Theme = "light" | "dark" | "system"
type Ctx = { theme: Theme; resolved: "light" | "dark"; setTheme: (t: Theme) => void }

const ThemeContext = createContext<Ctx | null>(null)
const KEY = "dx-theme"

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" || v === "system" ? v : "system"
  } catch {
    return "system"
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored)
  const [sysDark, setSysDark] = useState(systemDark)
  const resolved = theme === "system" ? (sysDark ? "dark" : "light") : theme

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const on = () => setSysDark(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark")
  }, [resolved])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* storage unavailable (private mode): theme still applies for this session */
    }
  }

  return <ThemeContext value={{ theme, resolved, setTheme }}>{children}</ThemeContext>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" }
const ICON = { light: Sun, dark: Moon, system: Monitor }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = ICON[theme]
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}
      title={`Theme: ${theme}`}
    >
      <Icon />
    </Button>
  )
}
