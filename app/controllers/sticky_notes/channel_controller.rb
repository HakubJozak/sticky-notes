module StickyNotes
  # Same-origin proxy to the daemon so remote browsing (caddy) works and the
  # token stays on the machine. Dev/staging only, like the routes.
  class ChannelController < ActionController::Base
    skip_forgery_protection # the overlay posts JSON with no form; the page token stands in for it
    before_action :require_channel_token

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

    # Without this a hostile page could POST notes into the reviewer's session
    # with a simple-request body; the header also forces a CORS preflight.
    def require_channel_token
      expected = "Bearer #{StickyNotes::Rails.channel_token}"
      return if ActiveSupport::SecurityUtils.secure_compare(request.authorization.to_s, expected)

      head :unauthorized
    end

    def daemon = StickyNotes::Rails.daemon
  end
end
