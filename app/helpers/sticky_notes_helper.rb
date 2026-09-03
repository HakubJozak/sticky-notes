module StickyNotesHelper
  # key: fixed notes bucket (default: page path); anchors: extra attributes
  # that count as stable anchors in exported paths, e.g. %w[data-qa].
  def sticky_notes_tag(key: nil, anchors: nil)
    return unless StickyNotes::Rails.enabled?

    # No daemon probe here: the page asks the proxy itself and reports what it
    # finds. A probe only ever hid the channel and offered Connect instead —
    # which would paste a loopback token into an app origin.
    channel = sticky_notes.sessions_path.delete_suffix(StickyNotes::Rails::Daemon::SESSIONS) if StickyNotes::Rails.channel?

    render "sticky_notes/tag", key:, anchors:, channel:, channel_token: (StickyNotes::Rails.channel_token if channel)
  end
end
