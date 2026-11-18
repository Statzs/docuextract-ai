import fs from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

// E2E runs the real FastAPI backend (offline demo extractor, throwaway SQLite DB) + Vite.
const backendDir = path.resolve(import.meta.dirname, "../backend")
const dbFile = path.join(backendDir, "e2e.db")
// The config is re-evaluated in test workers; only the main process may reset the DB.
if (!process.env.TEST_WORKER_INDEX) fs.rmSync(dbFile, { force: true })

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000, // first run after a dependency change waits on Vite re-optimising
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run uvicorn app.main:app --host 127.0.0.1 --port 8001",
      cwd: backendDir,
      url: "http://127.0.0.1:8001/api/health",
      env: { DATABASE_URL: "sqlite:///./e2e.db", GEMINI_API_KEY: "", ENVIRONMENT: "test" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite --port 5174 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:5174",
      env: { VITE_API_PROXY: "http://127.0.0.1:8001" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
