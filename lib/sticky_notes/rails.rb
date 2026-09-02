require "sticky_notes/rails/version"
require "sticky_notes/rails/engine"

module StickyNotes
  module Rails
    # A review tool, not a product feature: on where reviewers work, off in
    # production, unless the host says otherwise via config.sticky_notes.enabled.
    def self.enabled?
      configured = ::Rails.application.config.sticky_notes.enabled
      return configured unless configured.nil?

      ::Rails.env.development? || ::Rails.env.staging?
    end
  end
end
