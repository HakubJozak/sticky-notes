# Not isolated, so the controller needs its full path. `script` rather than
# `asset` — asset_path is already an ActionView helper.
StickyNotes::Rails::Engine.routes.draw do
  # Live delivery is development-only, the overlay itself is not.
  if StickyNotes::Rails.channel?
    get "sessions", to: "sticky_notes/channel#sessions", as: :sessions
    post "notes", to: "sticky_notes/channel#notes", as: :notes
  end

  get ":name", to: "sticky_notes/assets#show", as: :script, format: false,
      constraints: { name: /(sticky-notes|turbo|stimulus)\.js/ }
end
