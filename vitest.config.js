export default {
  test: {
    // path.js works on real DOM nodes; store/exporter are pure but ride along
    environment: "jsdom",
    setupFiles: ["./vitest.setup.js"],
    include: ["test/**/*.test.js"],
  },
}
