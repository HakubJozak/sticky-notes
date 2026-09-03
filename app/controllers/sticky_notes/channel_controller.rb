module StickyNotes
  # Same-origin proxy to the daemon so remote browsing (caddy) works and the
  # token stays on the machine. Dev/staging only, like the routes.
  class ChannelController < ActionController::Base
    skip_forgery_protection # the overlay posts JSON with no form; the routes only exist where the overlay does

    def sessions
      render json: daemon.sessions(root: ::Rails.root.to_s)
    rescue StickyNotes::Rails::Daemon::Unreachable
      head :service_unavailable
    end

    def notes
      status, body = daemon.post_notes(request.raw_post)
      render json: body, status:
    rescue StickyNotes::Rails::Daemon::Unreachable
      head :service_unavailable
    end

    private

    def daemon = StickyNotes::Rails.daemon
  end
end
