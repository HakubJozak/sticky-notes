module StickyNotes
  # Serves the prebuilt dist/ files straight from the gem — no asset pipeline
  # entry, no host wiring. Inherits ActionController::Base directly so host
  # authentication and layouts never apply.
  class AssetsController < ActionController::Base
    skip_forgery_protection

    JAVASCRIPT = "text/javascript".freeze

    def show
      file = StickyNotes::Rails::Engine.root.join("dist", params[:name])
      return head :not_found unless File.file?(file)

      fresh_when(last_modified: file.mtime)
      return if performed?

      send_file file, type: JAVASCRIPT, disposition: :inline
    end
  end
end
