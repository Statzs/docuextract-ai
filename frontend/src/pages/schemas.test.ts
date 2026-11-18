import { expect, it } from "vitest"
import { toKey } from "./schemas"

it("derives valid snake_case keys from labels", () => {
  expect(toKey("PO Número")).toBe("po_numero")
  expect(toKey("  Total (USD) ")).toBe("total_usd")
  expect(toKey("2nd address")).toBe("nd_address")
  expect(toKey("x".repeat(60))).toHaveLength(40)
})
