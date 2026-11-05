"""Failure diagnostics must not turn private fixture values into CI logs."""
from tests.support.browser_harness import diagnostic_request
from tests.support.browser_harness import SiteBrowser
import pytest


def test_diagnostic_request_only_reports_known_routes_and_status():
    assert diagnostic_request('http://127.0.0.1:4321/api/operator-partners?resource=session&token=secret', 401) == {'route': '/api/operator-partners', 'status': 401}
    assert diagnostic_request('http://127.0.0.1:4321/assets/partner-owner.js?v=secret', 200) == {'route': '/assets/partner-owner.js', 'status': 200}
    for url in ['https://example.com/api/config', 'http://127.0.0.1:4321/private/secret', 'http://127.0.0.1:4321/api/request?password=secret']:
        assert diagnostic_request(url, 500) is None


def test_owner_failure_reports_startup_boundary_without_private_values(capsys):
    with pytest.raises(RuntimeError, match='synthetic failure'):
        with SiteBrowser() as site:
            site.page.route('http://127.0.0.1:4321/**', lambda route: route.fulfill(
                status=401 if '/api/' in route.request.url else 200,
                content_type='text/html',
                body='<main id="owner-content"><h1>private-body-value</h1></main>'))
            site.page.goto('http://127.0.0.1:4321/partners')
            site.page.evaluate("fetch('/api/config?token=private-query-value').then(r=>r.text())")
            raise RuntimeError('synthetic failure')
    output = capsys.readouterr().out
    assert 'Owner browser failure:' in output and '"status": 401' in output
    assert 'private-body-value' not in output and 'private-query-value' not in output
