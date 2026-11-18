import { afterEach, describe, expect, it, vi } from "vitest"
import { api, ApiError } from "./api"

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

describe("api client", () => {
  it("maps FastAPI string errors", async () => {
    respond(401, { detail: "Invalid email or password." })
    await expect(api.login("a@b.co", "x")).rejects.toMatchObject({ status: 401, message: "Invalid email or password." })
  })

  it("maps pydantic validation errors to fields", async () => {
    respond(422, { detail: [{ loc: ["body", "password"], msg: "String should have at least 8 characters" }] })
    const err = await api.register("A", "a@b.co", "x").catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.fields.password).toMatch(/at least 8/)
  })

  it("maps review field errors", async () => {
    respond(422, { detail: { message: "Some fields are invalid.", fields: { total: "Expected a valid currency." } } })
    const err = await api.review("id", { total: "x" }, true).catch((e) => e)
    expect(err.message).toBe("Some fields are invalid.")
    expect(err.fields.total).toBe("Expected a valid currency.")
  })

  it("reports network failures clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(api.me()).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/reach the server/) })
  })

  it("never leaks a generic 500 body", async () => {
    respond(500, { detail: null })
    await expect(api.schemas()).rejects.toMatchObject({ message: expect.stringMatching(/on our side/) })
  })
})
