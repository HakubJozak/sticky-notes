require_relative "lib/sticky_notes/rails/version"

Gem::Specification.new do |spec|
  spec.name = "sticky-notes-rails"
  spec.version = StickyNotes::Rails::VERSION
  spec.authors = ["Jakub Hozák"]
  spec.summary = "In-place review layer for Rails apps — pin notes to elements, export CSS path · text · comment."
  spec.description = "Mounts the sticky-notes review layer into a Rails app: one layout tag, prebuilt JS served from the gem, dev and staging only."
  spec.homepage = "https://github.com/HakubJozak/sticky-notes"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1"

  # No `git ls-files`: the repo is consumed via `github:` before any tag exists.
  spec.files = Dir["lib/**/*", "app/**/*", "config/**/*", "dist/*.js", "skill/**/*", "README.md", "LICENSE"]
  spec.require_paths = ["lib"]

  spec.add_dependency "http", ">= 5"
  spec.add_dependency "railties", ">= 7.0"
end
