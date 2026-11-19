import fs from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"

const SAMPLES = path.resolve(import.meta.dirname, "../../backend/app/demo/samples")
const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`

async function register(page: Page, email = unique()) {
  await page.goto("/register")
  await page.getByLabel("Name").fill("Grace Hopper")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("correct-horse-battery")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByRole("heading", { name: "Hello, Grace" })).toBeVisible()
  return email
}

test("unauthenticated users are sent to sign in, and bad credentials are explained", async ({ page }) => {
  await page.goto("/app/documents")
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel("Email").fill("nobody@example.com")
  await page.getByLabel("Password").fill("wrong-password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toContainText("Invalid email or password")
})

test("register → upload → review → validate → export CSV", async ({ page }) => {
  await register(page)

  // Empty state is shown before any upload.
  await page.getByRole("link", { name: "My documents" }).click()
  await expect(page.getByText("Your document history is empty")).toBeVisible()

  await page.getByRole("button", { name: "Upload your first document" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByTestId("file-input").setInputFiles(path.join(SAMPLES, "invoice-halden-roe-0142.pdf"))
  // The type is suggested from the document's text; the user only confirms.
  await expect(dialog.getByRole("radio", { name: /Invoice.*Suggested/ })).toHaveAttribute("aria-checked", "true")
  await dialog.getByRole("button", { name: "Extract information" }).click()

  // Lands on the review screen once processing finishes.
  await expect(page.getByText("Needs review").first()).toBeVisible()
  const total = page.getByLabel(/^Total/)
  await expect(total).toHaveValue("3834.00")
  await expect(page.getByLabel(/^Invoice Number/)).toHaveValue("HR-2026-0142")

  // Invalid edit is rejected inline by the server's validation.
  await total.fill("a lot")
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Expected a valid currency.")).toBeVisible()

  await total.fill("3900")
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Validated", { exact: true }).first()).toBeVisible()
  await expect(total).toHaveValue("3900.00")

  await expect(page.getByText("Text reading").first()).toBeVisible() // how the values were read
  await page.getByRole("button", { name: "Download" }).click()
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /CSV/ }).click()])
  const csv = fs.readFileSync(await download.path(), "utf8")
  expect(csv).toContain("invoice_number")
  expect(csv).toContain("HR-2026-0142")
  expect(csv).toContain("3900.0")
})

test("unsupported files are rejected before and after upload", async ({ page }) => {
  await register(page)
  await page.getByRole("button", { name: "Extract a document" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") })
  await expect(dialog.getByText("Use a PDF, PNG, JPEG or WebP file.")).toBeVisible()
  // A file that lies about its type is caught by the server's magic-byte check.
  await dialog.getByRole("button", { name: "Other file" }).click()
  await dialog.getByTestId("file-input").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>not a pdf</html>") })
  await expect(dialog.getByText(/Unsupported file type/)).toBeVisible()
})

test("demo workspace: seeded data, schema editor, usage", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: /Try the demo/ }).click()
  await expect(page.getByText("Recent documents")).toBeVisible()
  await expect(page.getByText("lease-14-linden-court.pdf")).toBeVisible()

  await page.getByRole("link", { name: "Templates" }).click()
  await page.getByRole("button", { name: "New template" }).click()
  await page.getByLabel("Name").fill("Delivery Note")
  await page.getByLabel("Field 1 label").fill("Note Number")
  await expect(page.getByLabel("Field 1 key")).toHaveValue("note_number")
  await page.getByRole("button", { name: "Create template" }).click()
  await expect(page.getByRole("heading", { name: "Delivery Note" })).toBeVisible()

  await page.getByRole("link", { name: "Usage" }).click()
  await expect(page.getByText("Success rate")).toBeVisible()
})

test("demo tour: extract a fictional sample in two clicks", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: /Try the demo/ }).click()
  const tour = page.getByRole("region", { name: /Start here/ })
  await expect(tour).toBeVisible()
  await tour.getByRole("button", { name: "Upload" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "purchase-order-northfield-5520" }).click()
  await expect(dialog.getByRole("radio", { name: /Purchase Order/ })).toHaveAttribute("aria-checked", "true")
  await dialog.getByRole("button", { name: "Extract information" }).click()
  await expect(page.getByLabel(/^PO Number/)).toHaveValue("NR-PO-5520")

  // Re-running a reviewed document asks first, because it discards the review.
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Validated", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Read again" }).click()
  await expect(page.getByRole("alertdialog")).toContainText("Your corrections and validation will be discarded")
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText("Validated", { exact: true }).first()).toBeVisible()
})

test("forgot password gives the same answer for any email", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("link", { name: "Forgot password?" }).click()
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible() // lazy route
  await page.getByLabel("Email").fill("someone@example.com")
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
})

test("a shared /demo link opens a fresh demo workspace in one step", async ({ page }) => {
  await page.goto("/demo")
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole("region", { name: /Start here/ })).toBeVisible()
})

test("landing page explains the product and opens the demo", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("spreadsheet")
  await page.getByRole("tab", { name: "Receipts" }).click()
  await expect(page.getByRole("tabpanel")).toContainText("Cafe Orilla")
  await page.getByRole("button", { name: /Try it now/ }).first().click()
  await expect(page).toHaveURL(/\/app$/)
})

test("a scanned photo waits for its type in the demo", async ({ page }) => {
  await page.goto("/demo")
  await page.getByRole("region", { name: /Start here/ }).getByRole("button", { name: "Open the photo" }).click()
  await expect(page.getByText("Not extracted").first()).toBeVisible()
  await expect(page.getByRole("radiogroup", { name: "Document type" })).toBeVisible()
})
