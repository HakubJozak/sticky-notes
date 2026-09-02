module StickyNotesHelper
  # key: fixed notes bucket (default: page path); anchors: extra attributes
  # that count as stable anchors in exported paths, e.g. %w[data-qa].
  def sticky_notes_tag(key: nil, anchors: nil)
    return unless StickyNotes::Rails.enabled?

    render "sticky_notes/tag", key:, anchors:
  end
end
