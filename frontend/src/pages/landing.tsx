import { useState } from "react"
import { Link } from "react-router"
import { motion } from "motion/react"
import {
  ArrowRight,
  Check,
  CreditCard,
  Download,
  FileText,
  ListChecks,
  Lock,
  Receipt,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  UploadCloud,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/common"
import { ThemeToggle } from "@/components/theme"
import { useMe } from "@/lib/queries"
import { cn } from "@/lib/utils"

const EXAMPLES = [
  {
    id: "invoice",
    label: "Invoices",
    icon: FileText,
    doc: ["Halden & Roe Studio", "Invoice Number: HR-2026-0142", "Issue Date: 02 Oct 2026", "Total: 3,834.00 USD"],
    rows: [
      ["Invoice number", "HR-2026-0142"],
      ["Vendor", "Halden & Roe Studio"],
      ["Issue date", "2026-10-02"],
      ["Total", "3834.00"],
      ["Currency", "USD"],
    ],
  },
  {
    id: "receipt",
    label: "Receipts",
    icon: Receipt,
    doc: ["Cafe Orilla", "2x Flat white      9.00", "Paid with Visa", "Total: 15.80"],
    rows: [
      ["Merchant", "Cafe Orilla"],
      ["Date", "2026-11-10"],
      ["Payment method", "Visa contactless"],
      ["Total", "15.80"],
    ],
  },
  {
    id: "contract",
    label: "Contracts",
    icon: ScrollText,
    doc: ["RESIDENTIAL LEASE", "Landlord: Marisol Vega", "Tenant: Jonah Whitfield", "Monthly Rent: 1,450.00"],
    rows: [
      ["First party", "Marisol Vega"],
      ["Second party", "Jonah Whitfield"],
      ["Start date", "2026-12-01"],
      ["Amount", "1450.00"],
    ],
  },
  {
    id: "po",
    label: "Purchase orders",
    icon: ShoppingCart,
    doc: ["PURCHASE ORDER", "PO Number: NR-PO-5520", "Supplier: Calder Steel", "Total: 2,260.00 GBP"],
    rows: [
      ["PO number", "NR-PO-5520"],
      ["Buyer", "Northfield Robotics"],
      ["Supplier", "Calder Steel Supplies"],
      ["Total", "2260.00"],
    ],
  },
  {
    id: "payment",
    label: "Payment records",
    icon: CreditCard,
    doc: ["PAYMENT CONFIRMATION", "Payer: Orchard Lane Bakery", "Amount: 1,275.50 USD", "Reference: TX-88213-QF"],
    rows: [
      ["Payer", "Orchard Lane Bakery"],
      ["Payee", "Greenmill Flour Co."],
      ["Amount", "1275.50"],
      ["Reference", "TX-88213-QF"],
    ],
  },
]

function Demo() {
  const [active, setActive] = useState(0)
  const ex = EXAMPLES[active]
  return (
    <div className="w-full">
      <div role="tablist" aria-label="Example documents" className="mb-4 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e, i) => (
          <button
            key={e.id}
            role="tab"
            aria-selected={i === active}
            aria-controls="example-panel"
            onClick={() => setActive(i)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              i === active ? "border-foreground/50 bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <e.icon className="size-3.5" aria-hidden /> {e.label}
          </button>
        ))}
      </div>
      <div id="example-panel" role="tabpanel" className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <motion.div
          key={`doc-${ex.id}`}
          initial={{ opacity: 0, y: 8, rotate: -1 }}
          animate={{ opacity: 1, y: 0, rotate: -1 }}
          className="rounded-xl border bg-card p-5 shadow-sm"
          aria-label="Original document (example)"
        >
          {ex.doc.map((line, i) => (
            <p key={line} className={cn("text-sm", i === 0 ? "mb-3 font-semibold tracking-tight" : "font-mono text-[12px] text-muted-foreground")}>
              {line}
            </p>
          ))}
          <div className="mt-4 space-y-1.5" aria-hidden>
            <div className="h-1.5 w-full rounded bg-muted" />
            <div className="h-1.5 w-3/4 rounded bg-muted" />
          </div>
        </motion.div>
        <ArrowRight className="mx-auto size-5 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden />
        <motion.div
          key={`rows-${ex.id}`}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
          className="overflow-hidden rounded-xl border bg-popover shadow-lg"
          aria-label="Extracted information (example)"
        >
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {ex.rows.map(([k, v], i) => (
                <tr key={k}>
                  <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-muted-foreground">
                    {k}
                  </th>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    <motion.span
                      initial={{ backgroundSize: "0% 62%" }}
                      animate={{ backgroundSize: "100% 62%" }}
                      transition={{ delay: 0.3 + i * 0.15, duration: 0.35 }}
                      className="marker"
                    >
                      {v}
                    </motion.span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </div>
  )
}

const STEPS = [
  { icon: UploadCloud, title: "Upload", body: "A PDF, a scan or a photo taken with your phone." },
  { icon: ListChecks, title: "Choose the type", body: "Invoice, receipt, contract… We often suggest it for you." },
  { icon: Download, title: "Check and download", body: "See each value next to the original, fix anything, then get Excel, CSV or JSON." },
]

export function LandingPage() {
  const { data: user } = useMe()
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Site">
            <a href="#how" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground sm:inline">
              How it works
            </a>
            <a href="#privacy" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground sm:inline">
              Privacy
            </a>
            <ThemeToggle />
            {user ? (
              <Button size="sm" render={<Link to="/app" />} nativeButton={false}>
                Open app
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" render={<Link to="/login" />} nativeButton={false}>
                  Sign in
                </Button>
                <Button size="sm" render={<Link to="/register" />} nativeButton={false}>
                  Sign up free
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:py-20">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden /> Free · works on any phone or computer
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Turn invoices, receipts and contracts into a <span className="marker">spreadsheet</span>.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                Upload a document and DocuExtract finds the dates, names, totals and reference numbers for you. Check them in
                seconds and download Excel, CSV or JSON. Nothing to install, nothing to configure.
              </p>
              <div className="mt-8 flex flex-col gap-2 sm:flex-row">
                <Button size="lg" render={<Link to="/demo" />} nativeButton={false}>
                  Try it now — no signup <ArrowRight />
                </Button>
                <Button size="lg" variant="outline" render={<Link to="/register" />} nativeButton={false}>
                  Create a free account
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">The demo opens a private workspace with fictional documents.</p>
            </motion.div>
            <Demo />
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-2 text-muted-foreground">Three steps. No templates to build, no technical words.</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-full bg-highlight font-mono text-xs font-semibold text-highlight-foreground">
                    {i + 1}
                  </span>
                  <s.icon className="size-5 text-muted-foreground" aria-hidden />
                </div>
                <h3 className="mt-4 font-medium">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted-foreground">
            Ready-made for invoices, receipts, contracts, purchase orders, payment records and general documents. Need
            something else? Describe your own fields once and reuse them.
          </p>
        </section>

        <section id="privacy" className="scroll-mt-16 border-y bg-surface">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:px-6 md:grid-cols-3">
            <div className="md:col-span-3">
              <h2 className="text-2xl font-semibold tracking-tight">Smart when you want it, private when you need it</h2>
              <p className="mt-2 max-w-2xl text-muted-foreground">You decide, for every document, how it is read.</p>
            </div>
            <Feature icon={Sparkles} title="Smart reading (AI)">
              Google Gemini reads the document like a person would, including messy layouts and photos. Best accuracy. Don't use
              it for confidential or personal documents: free AI services may use what they receive to improve their products.
            </Feature>
            <Feature icon={Lock} title="Private reading (no AI)">
              The text is read on our own server: the PDF's text, or OCR for scans and photos. Nothing is sent to an AI
              service. Works best on clear, labelled documents.
            </Feature>
            <Feature icon={ShieldCheck} title="Honest results">
              Nothing is invented: if a value isn't in the document, the field stays empty. Every value shows how sure we are
              and how it was read, and you can delete a document or your whole account at any time.
            </Feature>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-col items-start gap-6 rounded-2xl border bg-card p-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <Smartphone className="size-5 text-muted-foreground" aria-hidden /> Try it in under a minute
              </h2>
              <ul className="mt-3 grid gap-1.5 text-sm text-muted-foreground">
                {["No signup for the demo", "Works on phone, tablet and computer", "Free to use"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check className="size-4 text-success" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <Button size="lg" render={<Link to="/demo" />} nativeButton={false}>
              Open the demo <ArrowRight />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <p>DocuExtract AI · an independent portfolio project. All example documents are fictional.</p>
          <a href="https://github.com/Statzs/docuextract-ai" className="underline-offset-4 hover:text-foreground hover:underline">
            Source code on GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}

function Feature({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
