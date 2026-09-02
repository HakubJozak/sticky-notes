require "rails/engine"

module StickyNotes
  module Rails
    # Deliberately NOT isolate_namespace: without isolation the engine's
    # app/helpers is prepended to the host's helpers_paths, so sticky_notes_tag
    # reaches controllers that inherit ActionController::Base directly.
    class Engine < ::Rails::Engine
      config.sticky_notes = ActiveSupport::OrderedOptions.new

      # Mount ourselves so a host needs zero edits beyond the layout tag.
      initializer "sticky_notes.routes" do |app|
        next unless StickyNotes::Rails.enabled?

        app.routes.append do
          mount StickyNotes::Rails::Engine => "/sticky-notes", as: "sticky_notes"
        end
      end
    end
  end
end
