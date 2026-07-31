import pytest
from pytest_httpserver import HTTPServer

from ezbeq.update import GithubReleaseChecker, UpdateChecker


@pytest.fixture
def checker(httpserver: HTTPServer) -> GithubReleaseChecker:
    return GithubReleaseChecker(url=httpserver.url_for('/releases/latest'))


def test_newer_tag_reports_update_available(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_json({'tag_name': '2.9.0'})
    result = checker.run('2.8.2')
    assert result == {'latest_version': '2.9.0', 'update_available': True}


def test_same_tag_reports_no_update_available(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_json({'tag_name': '2.9.0'})
    result = checker.run('2.9.0')
    assert result == {'latest_version': '2.9.0', 'update_available': False}


def test_older_tag_reports_no_update_available(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_json({'tag_name': '2.8.0'})
    result = checker.run('2.9.0')
    assert result == {'latest_version': '2.8.0', 'update_available': False}


def test_v_prefixed_tag_is_handled(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_json({'tag_name': 'v2.9.0'})
    result = checker.run('2.8.2')
    assert result == {'latest_version': 'v2.9.0', 'update_available': True}


def test_non_200_response_returns_none(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_data('rate limited', status=403)
    assert checker.run('2.9.0') is None


def test_malformed_json_returns_none(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_data('not json', content_type='application/json')
    assert checker.run('2.9.0') is None


def test_missing_tag_name_returns_none(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_json({'name': 'no tag here'})
    assert checker.run('2.9.0') is None


def test_unparseable_current_version_returns_none(checker, httpserver: HTTPServer):
    httpserver.expect_request('/releases/latest').respond_with_json({'tag_name': '2.9.0'})
    assert checker.run('UNKNOWN') is None


def test_unreachable_host_returns_none():
    checker = GithubReleaseChecker(url='http://127.0.0.1:1/releases/latest')
    assert checker.run('2.9.0') is None


def test_update_checker_disabled_never_has_result():
    update_checker = UpdateChecker('2.9.0', check_interval=86400.0, enabled=False)
    assert update_checker.result is None
