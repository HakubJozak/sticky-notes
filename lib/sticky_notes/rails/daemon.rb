require "http"
require "json"

module StickyNotes
  module Rails
    # Client for the sticky-notes daemon on this machine (docs/live-delivery.html).
    # Port and token come from daemon.json; the browser never sees either.
    class Daemon
      INFO_FILE = "daemon.json".freeze
      SESSIONS = "/sessions".freeze
      NOTES = "/notes".freeze
      LOOPBACK = "127.0.0.1".freeze
      TIMEOUT = 2 # s — a wedged daemon must not stall page loads

      Unreachable = Class.new(StandardError)

      def self.default_home
        ENV.fetch("STICKY_NOTES_HOME") { File.join(Dir.home, ".cache", "sticky-notes") }
      end

      def initialize(home: self.class.default_home)
        @info_path = File.join(home, INFO_FILE)
      end

      def alive?
        request(:get, SESSIONS).status.success?
      rescue Unreachable
        false
      end

      # cwd == root first, then ancestors of root (closest first), then the rest.
      def sessions(root:)
        response = request(:get, SESSIONS)
        raise Unreachable, "daemon answered #{response.status}" unless response.status.success?

        JSON.parse(response.body.to_s).sort_by { |session| [rank(session["cwd"], root), -session["cwd"].length] }
      end

      def post_notes(json)
        response = request(:post, NOTES, body: json)

        [response.status.code, response.body.to_s]
      end

      private

      def rank(cwd, root)
        return 0 if cwd == root
        return 1 if root.start_with?("#{cwd}/")

        2
      end

      def request(method, path, body: nil)
        info = read_info or raise Unreachable, "no #{@info_path}"

        HTTP.timeout(global: TIMEOUT)
            .auth("Bearer #{info["token"]}")
            .headers(content_type: "application/json")
            .request(method, "http://#{LOOPBACK}:#{info["port"]}#{path}", body:)
      rescue HTTP::Error, SystemCallError => e
        raise Unreachable, e.message
      end

      # daemon.json is written unguarded, so a restart can be read half-written:
      # garbage there means no daemon, never an exception in a page render.
      def read_info
        return unless File.file?(@info_path)

        JSON.parse(File.read(@info_path))
      rescue JSON::ParserError, SystemCallError
        nil
      end
    end
  end
end
