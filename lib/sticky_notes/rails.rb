require "digest"

require "sticky_notes/rails/version"
require "sticky_notes/rails/engine"
require "sticky_notes/rails/daemon"

module StickyNotes
  module Rails
    CHANNEL_TOKEN_SALT = "sticky-notes:".freeze
    CHANNEL_TOKEN_LENGTH = 32

    # A review tool, not a product feature: on where reviewers work, off in
    # production, unless the host says otherwise via config.sticky_notes.enabled.
    def self.enabled?
      configured = ::Rails.application.config.sticky_notes.enabled
      return configured unless configured.nil?

      ::Rails.env.development? || ::Rails.env.staging?
    end

    # Live delivery reaches the reviewer's own machine: development only, unless
    # the host opts in (a staging box behind a VPN) via config.sticky_notes.channel.
    def self.channel?
      enabled? && (::Rails.env.development? || ::Rails.application.config.sticky_notes.channel == true)
    end

    # Proves a channel request came from a page this app rendered: a hostile page
    # can guess the engine URL but not this, and sending it as an Authorization
    # header forces a CORS preflight the engine never answers. Derived, not
    # random: multi-worker puma must hand out one token, not one per worker.
    def self.channel_token
      @channel_token ||= Digest::SHA256.hexdigest("#{CHANNEL_TOKEN_SALT}#{::Rails.application.secret_key_base}")[0, CHANNEL_TOKEN_LENGTH]
    end

    # A fresh client each call: it holds nothing but a path, and STICKY_NOTES_HOME
    # can change between calls.
    def self.daemon
      Daemon.new
    end
  end
end
