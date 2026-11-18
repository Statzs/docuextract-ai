import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { ConfidenceMeter, StatusBadge } from "./common"

it("renders an accessible status label", () => {
  render(<StatusBadge status="needs_review" />)
  expect(screen.getByText("Needs review")).toBeInTheDocument()
})

it("shows confidence as a percentage", () => {
  render(<ConfidenceMeter value={0.934} />)
  expect(screen.getByText("93%")).toBeInTheDocument()
  expect(screen.getByTitle("Model confidence 93%")).toBeInTheDocument()
})
