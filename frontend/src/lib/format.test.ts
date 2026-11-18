import { describe, expect, it } from "vitest"
import { displayValue, formatBytes, parseInput, timeAgo, toInput } from "./format"

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2 KB")
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB")
  })

  it("displays typed values and never throws on empty", () => {
    expect(displayValue(null, "string")).toBe("—")
    expect(displayValue(true, "boolean")).toBe("Yes")
    expect(displayValue(1234.5, "currency")).toBe("1,234.50")
  })

  it("round-trips form inputs", () => {
    expect(toInput(2122.5, "currency")).toBe("2122.50")
    expect(toInput(false, "boolean")).toBe("false")
    expect(toInput(null, "date")).toBe("")
    expect(parseInput("  ", "string")).toBeNull()
    expect(parseInput("true", "boolean")).toBe(true)
    expect(parseInput(" 12.5 ", "number")).toBe("12.5")
  })

  it("renders relative time", () => {
    const now = Date.parse("2026-11-18T12:00:00Z")
    expect(timeAgo("2026-11-18T11:59:30Z", now)).toBe("just now")
    expect(timeAgo("2026-11-17T12:00:00Z", now)).toBe("yesterday")
    expect(timeAgo("2026-11-18T09:00:00Z", now)).toBe("3 hours ago")
  })
})
