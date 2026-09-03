require_relative "test_helper"

class ChannelTest < Minitest::Test
  include Rack::Test::Methods
  include DaemonHarness

  JSON_TYPE = { "CONTENT_TYPE" => "application/json" }.freeze

  def app = DummyApp

  # Every channel call carries the token the engine rendered into the page.
  def page_token = { "HTTP_AUTHORIZATION" => "Bearer #{StickyNotes::Rails.channel_token}" }

  def get_channel(path) = get(path, {}, page_token)

  def post_channel(path, body) = post(path, body.to_json, page_token.merge(JSON_TYPE))

  def setup = start_daemon

  def teardown = stop_daemon

  def test_sessions_are_ordered_for_rails_root
    register_session(cwd: "/elsewhere")
    register_session(cwd: Rails.root.to_s)
    register_session(cwd: Rails.root.dirname.to_s)

    get_channel "/sticky-notes/sessions"

    assert_equal 200, last_response.status
    assert_equal [Rails.root.to_s, Rails.root.dirname.to_s, "/elsewhere"], JSON.parse(last_response.body).map { _1["cwd"] }
  end

  def test_sessions_are_503_without_a_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir

    get_channel "/sticky-notes/sessions"

    assert_equal 503, last_response.status
  end

  def test_notes_are_forwarded_and_reach_the_session
    socket = register_session(cwd: Rails.root.to_s)
    get_channel "/sticky-notes/sessions"
    id = JSON.parse(last_response.body).first["id"]

    body = { session: id, url: "http://x/kids/1", key: "/kids/1", title: "Kid", notes: [{ n: 1, path: "#a", text: "A", ctx: "", note: "fix" }] }
    post_channel "/sticky-notes/notes", body

    assert_equal 200, last_response.status
    assert_equal({ "delivered" => true }, JSON.parse(last_response.body))

    event = JSON.parse(socket.gets)
    assert_equal "event", event["type"]
    assert_includes event["content"], "# Notes on Kid"
  end

  def test_daemon_errors_pass_through
    post_channel "/sticky-notes/notes", { session: "s99", url: "u", key: "k", title: "t", notes: [] }

    assert_equal 404, last_response.status
    assert_equal({ "error" => "unknown session" }, JSON.parse(last_response.body))
  end

  def test_notes_are_503_without_a_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir

    post_channel "/sticky-notes/notes", { session: "s1", url: "u", key: "k", title: "t", notes: [] }

    assert_equal 503, last_response.status
  end

  # daemon.json is written unguarded, so a restart can be caught half-written.
  def test_a_corrupt_daemon_file_reads_as_no_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir
    File.write(File.join(ENV["STICKY_NOTES_HOME"], "daemon.json"), "{")

    get_channel "/sticky-notes/sessions"

    assert_equal 503, last_response.status
  end

  # Without the token a hostile page could post notes into the reviewer's session.
  def test_channel_calls_without_the_page_token_are_unauthorized
    get "/sticky-notes/sessions"
    assert_equal 401, last_response.status

    post "/sticky-notes/notes", { session: "s1", url: "u", key: "k", title: "t", notes: [] }.to_json, JSON_TYPE
    assert_equal 401, last_response.status
  end

  # Derived from secret_key_base: every puma worker must accept the same token.
  def test_the_channel_token_is_stable_hex
    assert_equal StickyNotes::Rails.channel_token, StickyNotes::Rails.channel_token
    assert_match(/\A[0-9a-f]{32}\z/, StickyNotes::Rails.channel_token)
  end

  # No render-path probe: the page asks the proxy and reports what it finds.
  def test_tag_carries_the_channel_whether_or_not_a_daemon_answers
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir

    html = PagesController.render(inline: "<%= sticky_notes_tag %>")

    assert_includes html, 'data-channel="/sticky-notes"'
    assert_includes html, %(data-channel-token="#{StickyNotes::Rails.channel_token}")
  end
end
