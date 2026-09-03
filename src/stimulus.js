import { Controller } from "@hotwired/stimulus"
import { createStickyNotes } from "./index.js"

// The controller element must NOT be data-turbo-temporary — Turbo would drop
// it from the restoration snapshot and the layer would never come back.
export default class extends Controller {
  static values = { key: String, channel: String, channelToken: String }

  connect() {
    this.notes = createStickyNotes({
      key: this.hasKeyValue ? this.keyValue : undefined,
      channel: this.hasChannelValue ? this.channelValue : undefined,
      channelToken: this.hasChannelTokenValue ? this.channelTokenValue : undefined,
      root: this.element
    })
    this.notes.mount()

    this.refresh = () => this.notes.refresh()
    this.teardown = () => this.notes.unmount()

    document.addEventListener("turbo:frame-render", this.refresh)
    document.addEventListener("turbo:morph", this.refresh)
    document.addEventListener("turbo:before-cache", this.teardown)
  }

  disconnect() {
    document.removeEventListener("turbo:frame-render", this.refresh)
    document.removeEventListener("turbo:morph", this.refresh)
    document.removeEventListener("turbo:before-cache", this.teardown)
    this.notes?.unmount()
    this.notes = null
  }
}
