require_relative "test_helper"

class ChannelTest < Minitest::Test
  include Rack::Test::Methods
  include DaemonHarness

  JSON_TYPE = { "CONTENT_TYPE" => "application/json" }.freeze

  def app = DummyApp

  def setup = start_daemon

  def teardown = stop_daemon

  def test_sessions_are_ordered_for_rails_root
    register_session(cwd: "/elsewhere")
    register_session(cwd: Rails.root.to_s)
    register_session(cwd: Rails.root.dirname.to_s)

    get "/sticky-notes/sessions"

    assert_equal 200, last_response.status
    assert_equal [Rails.root.to_s, Rails.root.dirname.to_s, "/elsewhere"], JSON.parse(last_response.body).map { _1["cwd"] }
  end

  def test_sessions_are_503_without_a_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir

    get "/sticky-notes/sessions"

    assert_equal 503, last_response.status
  end

  def test_notes_are_forwarded_and_reach_the_session
    socket = register_session(cwd: Rails.root.to_s)
    get "/sticky-notes/sessions"
    id = JSON.parse(last_response.body).first["id"]

    body = { session: id, url: "http://x/kids/1", key: "/kids/1", title: "Kid", notes: [{ n: 1, path: "#a", text: "A", ctx: "", note: "fix" }] }
    post "/sticky-notes/notes", body.to_json, JSON_TYPE

    assert_equal 200, last_response.status
    assert_equal({ "delivered" => true }, JSON.parse(last_response.body))

    event = JSON.parse(socket.gets)
    assert_equal "event", event["type"]
    assert_includes event["content"], "# Notes on Kid"
  end

  def test_daemon_errors_pass_through
    post "/sticky-notes/notes", { session: "s99", url: "u", key: "k", title: "t", notes: [] }.to_json, JSON_TYPE

    assert_equal 404, last_response.status
    assert_equal({ "error" => "unknown session" }, JSON.parse(last_response.body))
  end

  def test_notes_are_503_without_a_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir

    post "/sticky-notes/notes", { session: "s1", url: "u", key: "k", title: "t", notes: [] }.to_json, JSON_TYPE

    assert_equal 503, last_response.status
  end

  # daemon.json is written unguarded, so a restart can be caught half-written.
  def test_a_corrupt_daemon_file_reads_as_no_daemon
    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir
    File.write(File.join(ENV["STICKY_NOTES_HOME"], "daemon.json"), "{")

    get "/sticky-notes/sessions"

    assert_equal 503, last_response.status
    refute_includes PagesController.render(inline: "<%= sticky_notes_tag %>"), "data-channel"
  end

  def test_tag_carries_the_channel_only_while_the_daemon_answers
    html = PagesController.render(inline: "<%= sticky_notes_tag %>")
    assert_includes html, 'data-channel="/sticky-notes"'

    ENV["STICKY_NOTES_HOME"] = Dir.mktmpdir
    html = PagesController.render(inline: "<%= sticky_notes_tag %>")
    refute_includes html, "data-channel"
  end
end
