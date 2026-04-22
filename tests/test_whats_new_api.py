import time


def test_returns_entry_when_since_predates_it(minidsp_client, minidsp_app):
    r = minidsp_client.get('/api/1/whats-new', query_string={'since': 0})
    assert r.status_code == 200
    entries = r.json
    assert len(entries) == 1
    entry = entries[0]
    assert entry['id'] == '123456_0'
    assert entry['formattedTitle'] == 'Alien Resurrection'
    assert entry['year'] == 1997
    assert entry['author'] == 'aron7awol'
    assert entry['content_type'] == 'film'
    assert entry['created_at'] == 1611984156
    assert entry['updated_at'] == 1543898641


def test_returns_empty_when_since_is_in_the_future(minidsp_client, minidsp_app):
    future = int(time.time()) + 60
    r = minidsp_client.get('/api/1/whats-new', query_string={'since': future})
    assert r.status_code == 200
    assert r.json == []


def test_default_since_is_two_weeks_excludes_old_entries(minidsp_client, minidsp_app):
    # The fixture entry has created_at=1611984156 (2021), so default 2-week window returns nothing.
    r = minidsp_client.get('/api/1/whats-new')
    assert r.status_code == 200
    assert r.json == []


def test_limit_parameter_is_respected(minidsp_client, minidsp_app):
    # Only one entry exists in the test catalogue; limit=1 should return it.
    r = minidsp_client.get('/api/1/whats-new', query_string={'since': 0, 'limit': 1})
    assert r.status_code == 200
    assert len(r.json) == 1


def test_ignores_invalid_since_value(minidsp_client, minidsp_app):
    r = minidsp_client.get('/api/1/whats-new', query_string={'since': 'not-a-number'})
    assert r.status_code == 400
