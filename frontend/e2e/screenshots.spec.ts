// Captures README screenshots and the demo video from the seeded demo workspace.
// Not part of the test suite:
//   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
// then turn the video into docs/demo.gif with ffmpeg (command in CONTRIBUTING.md).
import path from "node:path"
import fs from "node:fs"
import { expect, test } from "@playwright/test"

const OUT = path.resolve(import.meta.dirname, "../../docs/screenshots")
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture README images")
// The default headless shell has no PDF viewer; installed Edge (new headless) does.
test.use({ channel: "msedge" }) // installed Edge, fresh temporary profile

for (const scheme of ["dark", "light"] as const) {
  test(`capture ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/login")
    await page.waitForTimeout(2500) // let the showcase finish
    await page.screenshot({ path: `${OUT}/login-${scheme}.png` })
    await page.getByRole("button", { name: /Try the demo/ }).click()
    await expect(page.getByText("Recent documents")).toBeVisible()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/dashboard-${scheme}.png` })
    await page.getByRole("link", { name: "My documents" }).click()
    await expect(page.getByText("invoice-brightwater-7781.pdf")).toBeVisible()
    await page.screenshot({ path: `${OUT}/documents-${scheme}.png` })
    await page.getByText("invoice-brightwater-7781.pdf").click()
    await expect(page.getByLabel(/^Total/)).toHaveValue("2525.78")
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/review-${scheme}.png` })
    await page.getByRole("link", { name: "Templates" }).click()
    await page.getByRole("button", { name: `Edit Invoice` }).click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/schema-editor-${scheme}.png` })
    await page.keyboard.press("Escape")
    await page.getByRole("link", { name: "Usage" }).click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/usage-${scheme}.png` })
  })
}

test("capture phone review", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/login")
  await page.getByRole("button", { name: /Try the demo/ }).click()
  await expect(page.getByText("Recent documents")).toBeVisible()
  await page.goto("/app/documents")
  await page.getByText("invoice-halden-roe-0142.pdf").click()
  await expect(page.getByLabel(/^Total/)).toHaveValue("3834.00")
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/review-phone-light.png` })
})

test("record demo video", async ({ browser }) => {
  test.setTimeout(120_000)
  const dir = path.join(OUT, "..", ".video")
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    recordVideo: { dir, size: { width: 1280, height: 800 } },
  })
  const page = await context.newPage()
  const pause = (ms = 900) => page.waitForTimeout(ms)
  await page.goto("/login")
  await pause(2600) // showcase animation
  await page.getByRole("button", { name: /Try the demo/ }).click()
  await expect(page.getByText("Recent documents")).toBeVisible()
  await pause(1500)
  await page.getByRole("region", { name: /Start here/ }).getByRole("button", { name: "Upload" }).click()
  const dialog = page.getByRole("dialog")
  await pause()
  await dialog.getByRole("button", { name: "invoice-halden-roe-0142" }).click()
  await pause()
  await dialog.getByRole("button", { name: "Extract information" }).click()
  const total = page.getByLabel(/^Total/)
  await expect(total).toHaveValue("3834.00")
  await pause(2000)
  await total.click()
  await total.fill("")
  await total.pressSequentially("3900", { delay: 120 })
  await pause()
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Validated", { exact: true }).first()).toBeVisible()
  await pause(1200)
  await page.getByRole("button", { name: "Download" }).click()
  await pause(1500)
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Usage" }).click()
  await pause(2200)
  const video = page.video()
  await context.close()
  fs.renameSync(await video!.path(), path.join(dir, "demo.webm"))
})
