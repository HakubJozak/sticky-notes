import { describe, it, expect } from "vitest"
import { slug } from "../src/slug.js"

describe("slug", () => {
  it("keeps letters and digits, joins the rest with one dash", () => {
    expect(slug("/kids/12")).toBe("kids-12")
    expect(slug("shop domain model")).toBe("shop-domain-model")
  })

  it("falls back to 'page' when nothing survives", () => {
    expect(slug("///")).toBe("page")
    expect(slug("")).toBe("page")
  })
})
