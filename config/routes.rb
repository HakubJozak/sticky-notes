# Not isolated, so the controller needs its full path. `script` rather than
# `asset` — asset_path is already an ActionView helper.
StickyNotes::Rails::Engine.routes.draw do
  get ":name", to: "sticky_notes/assets#show", as: :script, format: false,
      constraints: { name: /(sticky-notes|turbo|stimulus)\.js/ }
end
