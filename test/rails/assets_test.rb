require_relative "test_helper"

class AssetsTest < Minitest::Test
  include Rack::Test::Methods

  def app = DummyApp

  def test_scripts_win_over_the_host_catch_all
    get "/sticky-notes/turbo.js"

    assert_equal 200, last_response.status
    assert_includes last_response.content_type, "javascript"
    assert_includes last_response.body, "attach"
  end
end
