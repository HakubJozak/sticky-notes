import { describe, it, expect, beforeEach } from "vitest"
import { cssPath, contextOf, excerpt } from "../src/path.js"

const html = (markup) => {
  document.body.innerHTML = markup

  return (selector) => document.querySelector(selector)
}

describe("cssPath", () => {
  beforeEach(() => (document.body.innerHTML = ""))

  it("stops at a default anchor attribute", () => {
    const $ = html(`<div data-testid="panel"><ul><li>a</li><li class="target">b</li></ul></div>`)

    expect(cssPath($(".target"))).toEqual({ path: `[data-testid="panel"] > ul > li:nth-of-type(2)`, anchored: true })
  })

  it("honours a custom anchors option", () => {
    const $ = html(`<div data-testid="panel" data-mine="x"><span>a</span></div>`)

    expect(cssPath($("span"), { anchors: ["data-mine"] }).path).toBe(`[data-mine="x"] > span`)
  })

  it("stops at the element's own id before climbing", () => {
    const $ = html(`<div data-testid="panel"><p id="target">b</p></div>`)

    expect(cssPath($("#target"))).toEqual({ path: "#target", anchored: true })
  })

  it("uses a unique, author-written id", () => {
    const $ = html(`<section id="report"><p>a</p><p>b</p></section>`)

    expect(cssPath($("p:last-child"))).toEqual({ path: "#report > p:nth-of-type(2)", anchored: true })
  })

  it("ignores framework-generated ids", () => {
    const $ = html(`<div id="radix-42"><b>x</b></div>`)

    expect(cssPath($("b"))).toEqual({ path: "div > b", anchored: false })
  })

  it("falls back to a sibling-order chain and reports it as unanchored", () => {
    const $ = html(`<div><span>a</span><span>b</span></div>`)

    expect(cssPath($("span:last-child"))).toEqual({ path: "div > span:nth-of-type(2)", anchored: false })
  })

  it("counts a form field name as an anchor", () => {
    const $ = html(`<form><input name="email"><input name="password"></form>`)

    expect(cssPath($('[name="password"]'))).toEqual({ path: `form > input[name="password"]`, anchored: true })
  })

  it("keeps a data-controller segment readable but weak", () => {
    const $ = html(`<div data-controller="chart"><i>x</i></div>`)

    expect(cssPath($("i"))).toEqual({ path: `div[data-controller="chart"] > i`, anchored: false })
  })

  it("escapes quotes in attribute values", () => {
    const $ = html(`<div data-testid='a"b'><em>x</em></div>`)

    expect(cssPath($("em")).path).toBe(`[data-testid="a\\"b"] > em`)
  })
})

describe("contextOf", () => {
  beforeEach(() => (document.body.innerHTML = ""))

  it("returns the nearest preceding heading", () => {
    const $ = html(`<h2>First</h2><p>a</p><h3>Second</h3><p id="t">b</p><h3>Third</h3>`)

    expect(contextOf($("#t"))).toBe("Second")
  })

  it("ignores headings inside our own layer", () => {
    const $ = html(`<h2>Real</h2><div class="sticky-notes-export"><h3>Ours</h3></div><p id="t">b</p>`)

    expect(contextOf($("#t"))).toBe("Real")
  })

  it("collapses whitespace in the heading", () => {
    const $ = html(`<h2>Long\n   heading</h2><p id="t">b</p>`)

    expect(contextOf($("#t"))).toBe("Long heading")
  })

  it("returns empty when no heading precedes the element", () => {
    const $ = html(`<p id="t">b</p><h2>Later</h2>`)

    expect(contextOf($("#t"))).toBe("")
  })
})

describe("excerpt", () => {
  beforeEach(() => (document.body.innerHTML = ""))

  it("condenses the element text", () => {
    const $ = html(`<p id="t">  hello   there\n friend </p>`)

    expect(excerpt($("#t"))).toBe("hello there friend")
  })

  it("truncates at 120 characters", () => {
    const $ = html(`<p id="t">${"x".repeat(200)}</p>`)

    expect(excerpt($("#t"))).toHaveLength(120)
  })

  it("uses the field value", () => {
    const $ = html(`<input id="t">`)
    $("#t").value = "typed"

    expect(excerpt($("#t"))).toBe("typed")
  })

  it("falls back to a linked label for an empty field", () => {
    const $ = html(`<label for="t">E-mail</label><input id="t">`)

    expect(excerpt($("#t"))).toBe("E-mail")
  })

  it("falls back to a wrapping label", () => {
    const $ = html(`<label>Agree <input class="t"></label>`)

    expect(excerpt($(".t"))).toBe("Agree")
  })

  it("falls back to aria-label, then placeholder", () => {
    const $ = html(`<input id="a" aria-label="Search"><input id="b" placeholder="Name">`)

    expect(excerpt($("#a"))).toBe("Search")
    expect(excerpt($("#b"))).toBe("Name")
  })

  it("returns an empty string when there is nothing to quote", () => {
    const $ = html(`<hr id="t">`)

    expect(excerpt($("#t"))).toBe("")
  })
})
