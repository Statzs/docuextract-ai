import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

// WCAG 2.1 A/AA rules on every screen, in both themes.
async function audit(page: Page, name: string) {
  await page.waitForTimeout(900) // let entry fades finish; mid-fade text reads as low contrast
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  const summary = violations.map((v) => `${name}: ${v.id} (${v.impact}) × ${v.nodes.length} — ${v.nodes.map((n) => n.target.join(" ") + " " + (n.any[0]?.message ?? "")).join(" | ")}`)
  expect(summary).toEqual([])
}

for (const theme of ["light", "dark"] as const) {
  test(`no axe violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    for (const path of ["/login", "/register", "/forgot-password", "/reset-password?token=x"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await audit(page, path)
    }

    await page.goto("/login")
    await page.getByRole("button", { name: /Explore the demo/ }).click()
    await expect(page.getByText("Recent documents")).toBeVisible()
    await audit(page, "dashboard")

    await page.getByRole("link", { name: "Documents" }).click()
    await expect(page.getByText("invoice-halden-roe-0142.pdf")).toBeVisible()
    await audit(page, "documents")

    await page.getByText("invoice-brightwater-7781.pdf").click()
    await expect(page.getByLabel(/^Invoice Number/)).toBeVisible()
    await audit(page, "document detail")

    await page.getByRole("link", { name: "Schemas" }).click()
    await expect(page.getByRole("heading", { name: "Invoice" })).toBeVisible()
    await audit(page, "schemas")

    await page.getByRole("link", { name: "API usage" }).click()
    await expect(page.getByText("Success rate")).toBeVisible()
    await audit(page, "usage")
  })
}
