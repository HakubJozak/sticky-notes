# Not isolated, so the controller needs its full path. `script` rather than
# `asset` — asset_path is already an ActionView helper.
StickyNotes::Rails::Engine.routes.draw do
  get "sessions", to: "sticky_notes/channel#sessions", as: :sessions
  post "notes", to: "sticky_notes/channel#notes", as: :notes

  get ":name", to: "sticky_notes/assets#show", as: :script, format: false,
      constraints: { name: /(sticky-notes|turbo|stimulus)\.js/ }
end
