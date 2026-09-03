require "rails"
require "action_controller/railtie"
require "sticky-notes-rails"
require "minitest/autorun"
require "rack/test"
require "tmpdir"
require "socket"
require "timeout"
require "json"
require "fileutils"

class DummyApp < Rails::Application
  config.eager_load = false
  config.secret_key_base = "sticky"
  config.logger = Logger.new(nil)
  config.hosts.clear
  config.sticky_notes.enabled = true
  # Rails.env is "development" here, but say it: the channel is what these tests exercise.
  config.sticky_notes.channel = true
  # Rails.root is the repo root here, so the engine's config/routes.rb would
  # also be read as the app's own and every engine route drawn twice.
  config.paths["config/routes.rb"] = []
end
DummyApp.initialize!

# A host controller gets `helper :all`, so sticky_notes_tag renders through it.
class PagesController < ActionController::Base; end

# The real daemon in a private home on an ephemeral port — no doubles.
module DaemonHarness
  ROOT = File.expand_path("../..", __dir__)
  DAEMON = File.join(ROOT, "server", "daemon.js")
  START_TIMEOUT = 5
  SETTLE = 0.1

  def start_daemon
    @home = Dir.mktmpdir("sticky-notes")
    ENV["STICKY_NOTES_HOME"] = @home
    log = File.join(@home, "daemon.log")
    @daemon = Process.spawn({ "STICKY_NOTES_HOME" => @home, "STICKY_NOTES_PORT" => "0" }, "node", DAEMON, out: log, err: log)
    Timeout.timeout(START_TIMEOUT) { sleep SETTLE until File.exist?(File.join(@home, "daemon.json")) }
  end

  def stop_daemon
    FileUtils.rm_rf(@home) if @home
    return unless @daemon # spawn failed: let its own error stand

    Process.kill("TERM", @daemon)
    Process.wait(@daemon)
  end

  # Stands in for a sticky-notes MCP server: registers over the unix socket
  # and returns the socket, which then receives the events.
  def register_session(cwd:, label: "test")
    socket = UNIXSocket.new(File.join(@home, "daemon.sock"))
    socket.puts({ type: "register", cwd:, pid: Process.pid, label: }.to_json)
    sleep SETTLE
    socket
  end
end
