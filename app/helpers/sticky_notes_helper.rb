module StickyNotesHelper
  # key: fixed notes bucket (default: page path); anchors: extra attributes
  # that count as stable anchors in exported paths, e.g. %w[data-qa].
  def sticky_notes_tag(key: nil, anchors: nil)
    return unless StickyNotes::Rails.enabled?

    # one loopback call per page load; connection refused is instant when the daemon is down
    channel = sticky_notes.sessions_path.delete_suffix(StickyNotes::Rails::Daemon::SESSIONS) if StickyNotes::Rails.daemon.alive?

    render "sticky_notes/tag", key:, anchors:, channel:
  end
end
