var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { Controller } from "@hotwired/stimulus";
import { createStickyNotes } from "./sticky-notes.js";
class stimulus extends Controller {
  connect() {
    this.notes = createStickyNotes({
      key: this.hasKeyValue ? this.keyValue : void 0,
      channel: this.hasChannelValue ? this.channelValue : void 0,
      channelToken: this.hasChannelTokenValue ? this.channelTokenValue : void 0,
      root: this.element
    });
    this.notes.mount();
    this.refresh = () => this.notes.refresh();
    this.teardown = () => this.notes.unmount();
    document.addEventListener("turbo:frame-render", this.refresh);
    document.addEventListener("turbo:morph", this.refresh);
    document.addEventListener("turbo:before-cache", this.teardown);
  }
  disconnect() {
    document.removeEventListener("turbo:frame-render", this.refresh);
    document.removeEventListener("turbo:morph", this.refresh);
    document.removeEventListener("turbo:before-cache", this.teardown);
    this.notes?.unmount();
    this.notes = null;
  }
}
__publicField(stimulus, "values", { key: String, channel: String, channelToken: String });
export {
  stimulus as default
};
