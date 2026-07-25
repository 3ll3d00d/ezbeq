import re
import urllib.parse

import pytest
from pytest_httpserver import HTTPServer

EXTSTATE_URI_PATTERN = re.compile(r"^/_/SET/EXTSTATE/.*")


def test_load_known_entry_via_filter_endpoint_and_then_clear(reaper_client, reaper_app, httpserver: HTTPServer):
    """
    Exercises the v1 PUT/DELETE .../filter/<slot> endpoint, which calls
    Reaper.load_filter()/clear_filter() directly (NOT via update()). This
    is the path that matters most for the mv_adjust fix, since
    load_filter() is where entry.mv_adjust is read directly rather than
    trusting the (unreliable) mv_adjust function parameter.
    """
    httpserver.expect_request(EXTSTATE_URI_PATTERN).respond_with_data("ok", content_type="text/plain")

    r = reaper_client.put(
        "/api/1/devices/reaper1/filter/REAPER",
        json={"entryId": "123456_0"},
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body["type"] == "reaper"
    assert body["slots"][0]["id"] == "REAPER"
    assert body["slots"][0]["last"] == "Alien Resurrection"

    payload = _last_extstate_payload(httpserver)
    assert "version=" in payload
    # Alien Resurrection's test catalogue entry has mv: "+3" - confirms
    # entry.mv_adjust (not the load_filter() mv_adjust parameter, which
    # ezbeq's real dispatcher never populates) is what actually gets sent.
    assert "mv=3.0" in payload

    # 5 identical LowShelf filters per the test catalogue fixture
    for i in range(1, 6):
        assert f"band{i} type=LowShelf freq=33.0 gain=5.0 q=0.9 enabled=1" in payload
    assert "band6" not in payload

    httpserver.clear_all_handlers()
    httpserver.expect_request(EXTSTATE_URI_PATTERN).respond_with_data("ok", content_type="text/plain")

    r = reaper_client.delete("/api/1/devices/reaper1/filter/REAPER")
    assert r.status_code == 200
    body = r.get_json()
    assert body["slots"][0]["last"] == "Empty"

    clear_payload = _last_extstate_payload(httpserver)
    assert "clear=1" in clear_payload


def test_load_known_entry_via_slots_endpoint(reaper_client, reaper_app, httpserver: HTTPServer):
    """
    Exercises the v2 PATCH .../devices/<name> endpoint, which calls
    Reaper.update() -> load_filter() - a different code path than the v1
    test above, but should behave identically since update() delegates
    straight to the same method.

    NOTE: clearing via this endpoint with {"entry": null} is NOT valid
    usage - ezbeq's own v2 request schema (flask-restx model validation)
    rejects null for the 'entry' field outright with a 400
    ("None is not of type 'string'"), confirmed empirically. Clearing is
    only covered here via the v1 DELETE .../filter/<slot> endpoint (see
    the test above), which is the correct way to clear a slot.
    """
    httpserver.expect_request(EXTSTATE_URI_PATTERN).respond_with_data("ok", content_type="text/plain")

    r = reaper_client.patch(
        "/api/2/devices/reaper1",
        json={"slots": [{"id": "REAPER", "entry": "123456_0"}]},
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body["slots"][0]["last"] == "Alien Resurrection"

    payload = _last_extstate_payload(httpserver)
    assert "mv=3.0" in payload
    assert "band1 type=LowShelf freq=33.0 gain=5.0 q=0.9 enabled=1" in payload


def test_unknown_entry_returns_404(reaper_client):
    """
    No filters should be sent to REAPER at all for an entry id that isn't
    in the catalogue - the request should fail fast with a 404 rather than
    forwarding garbage.
    """
    r = reaper_client.put(
        "/api/1/devices/reaper1/filter/REAPER",
        json={"entryId": "does-not-exist"},
    )
    assert r.status_code == 404


def _last_extstate_payload(httpserver: HTTPServer) -> str:
    """
    Pulls the most recent request matching our SET/EXTSTATE handler out of
    httpserver.log and url-decodes the payload REAPER (in real life) would
    have received - httpserver.log is pytest_httpserver's built-in record
    of every request/response pair, which serves the same purpose here as
    the custom Spy objects used for the minidsp/camilladsp devices, since
    Reaper's device makes plain HTTP calls with no CLI/websocket layer to
    intercept instead.
    """
    matching = [
        req for req, _ in httpserver.log
        if req.path.startswith("/_/SET/EXTSTATE/")
    ]
    assert matching, "no SET/EXTSTATE request was received by the fake REAPER server"
    last_request = matching[-1]
    # The payload is the final path segment, url-encoded by reaper.py's
    # urllib.parse.quote(payload, safe='') - decode it back to plain text.
    encoded_payload = last_request.path.split("/")[-1]
    return urllib.parse.unquote(encoded_payload)
