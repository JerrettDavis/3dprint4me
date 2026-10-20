from __future__ import annotations

import json
import pytest
from urllib.parse import urlsplit, parse_qs
from tests.e2e.test_api import project_request
from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import json_request


def fill_invoice_form(panel) -> None:
    for label, value in [('Invoice Ninja client ID', 'client123'), ('Due date', '2099-12-31'), ('Street address', '123 Example St'), ('City', 'Tulsa'), ('State', 'OK'), ('ZIP code', '74110'), ('Tax jurisdiction', 'Tulsa'), ('Tax evidence or rate reference', 'City schedule'), ('Item', 'Signs and bases'), ('Unit price ($)', '140.00'), ('Tax rate (%)', '8.517'), ('Tax reason or exemption', 'Physical goods')]:
        panel.get_by_label(label, exact=True).fill(value)
    panel.get_by_label('Prior payments or deposits', exact=True).select_option('none')


@pytest.mark.parametrize('width', [1280, 390])
def test_owner_previews_confirmed_amounts_and_creates_only_a_draft(width: int) -> None:
    with running_operator_workspace() as (storefront, operator, _):
        request = project_request()
        _, _, created = json_request(storefront + '/api/request', method='POST', payload={'request': request, 'website': ''})
        status, _, _ = json_request(storefront + '/api/request', method='PATCH', payload={'id': created['id'], 'request': request, 'uploadedFiles': []})
        assert status == 200
        with SiteBrowser(viewport=(width, 900), service_workers='block') as site:
            page = site.page
            actions = []
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def billing_route(route):
                headers = {'Access-Control-Allow-Origin': operator, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
                req = route.request
                if req.method == 'OPTIONS':
                    route.fulfill(status=204, headers=headers)
                    return
                if req.method == 'GET':
                    body = {'configured': True, 'operation': None}
                else:
                    data = req.post_data_json
                    actions.append(data)
                    if data['action'] == 'preview':
                        body = {'billing': data['command']['billing'], 'totals': {'subtotalCents': 14000, 'taxCents': 1192, 'totalCents': 15192}}
                    else:
                        assert data['action'] == 'create'
                        body = {'operation': {'state': 'draft', 'totals': {'subtotalCents': 14000, 'taxCents': 1192, 'totalCents': 15192}, 'provider': {'number': '3DP-2026-example', 'status': 'draft', 'balanceCents': 15192, 'editorUrl': 'https://app.invoicing.co/#/invoices/invoice123/edit'}}}
                route.fulfill(status=200, content_type='application/json', body=json.dumps(body), headers=headers)

            page.route('**/api/operator-work?resource=invoices*', billing_route)
            page.goto(operator, wait_until='networkidle')
            page.locator('#work-list .work-row').click()
            panel = page.get_by_role('region', name='Invoice drafts')
            panel.wait_for()
            page.wait_for_timeout(300)
            assert panel.locator('summary').count(), panel.inner_text() + '\n' + str(errors)
            panel.get_by_text('Create an invoice draft', exact=True).click()
            fill_invoice_form(panel)
            panel.get_by_role('button', name='Preview confirmed amounts').click()
            panel.get_by_text('Total $151.92', exact=False).wait_for()
            assert len(actions) == 1 and actions[0]['action'] == 'preview'
            panel.get_by_role('button', name='Confirm and create draft').click()
            panel.get_by_text('Draft ready for review', exact=True).wait_for()
            assert [a['action'] for a in actions] == ['preview', 'create']
            assert actions[1]['command']['billing']['lines'][0]['taxRateMilli'] == 8517
            assert panel.get_by_role('link', name='Review in Invoice Ninja').get_attribute('href').endswith('/invoice123/edit')
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
            site.assert_no_page_errors(allow_console_warnings=['Service Worker registration blocked by Playwright'])


def test_expired_session_clears_private_billing_inputs() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        request = project_request()
        _, _, created = json_request(storefront + '/api/request', method='POST', payload={'request': request, 'website': ''})
        json_request(storefront + '/api/request', method='PATCH', payload={'id': created['id'], 'request': request, 'uploadedFiles': []})
        with SiteBrowser(service_workers='block') as site:
            page = site.page
            expired = False
            headers = {'Access-Control-Allow-Origin': operator, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
            def session(route):
                if expired:
                    route.fulfill(status=401, content_type='application/json', body=json.dumps({'error': 'Sign in required.'}), headers=headers)
                else:
                    route.continue_()
            def billing(route):
                nonlocal expired
                if route.request.method == 'GET':
                    route.fulfill(status=200, content_type='application/json', body=json.dumps({'configured': True, 'operation': None}), headers=headers)
                else:
                    expired = True
                    route.fulfill(status=401, content_type='application/json', body=json.dumps({'error': 'Sign in required.'}), headers=headers)
            page.route('**/api/operator-session', session)
            page.route('**/api/operator-work?resource=invoices*', billing)
            page.goto(operator, wait_until='networkidle')
            page.locator('#work-list .work-row').click()
            panel = page.get_by_role('region', name='Invoice drafts')
            panel.locator('summary').click()
            fill_invoice_form(panel)
            panel.get_by_role('button', name='Preview confirmed amounts').click()
            page.locator('#auth-view:not([hidden])').wait_for()
            assert page.locator('.invoice-sheet input').count() == 0


def test_late_billing_response_cannot_replace_another_jobs_panel() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        for title in ['Billing job Alpha', 'Billing job Beta']:
            request = project_request()
            request['projectTitle'] = title
            _, _, created = json_request(storefront + '/api/request', method='POST', payload={'request': request, 'website': ''})
            json_request(storefront + '/api/request', method='PATCH', payload={'id': created['id'], 'request': request, 'uploadedFiles': []})
        with SiteBrowser(service_workers='block') as site:
            page = site.page
            held = []
            first_id = None
            headers = {'Access-Control-Allow-Origin': operator, 'Access-Control-Allow-Credentials': 'true'}
            def billing(route):
                nonlocal first_id
                work_id = parse_qs(urlsplit(route.request.url).query)['workId'][0]
                if first_id is None:
                    first_id = work_id
                    held.append(route)
                else:
                    route.fulfill(status=200, content_type='application/json', body=json.dumps({'configured': True, 'operation': {'state': 'needs_reconciliation', 'provider': None}}), headers=headers)
            page.route('**/api/operator-work?resource=invoices*', billing)
            page.goto(operator, wait_until='networkidle')
            page.locator('#work-list .work-row', has_text='Billing job Alpha').click()
            page.get_by_role('region', name='Invoice drafts').get_by_text('Loading billing status…').wait_for()
            page.wait_for_timeout(100)
            assert held
            page.locator('#work-list .work-row', has_text='Billing job Beta').click()
            panel = page.get_by_role('region', name='Invoice drafts')
            panel.get_by_text('Creation needs reconciliation', exact=True).wait_for()
            held[0].fulfill(status=200, content_type='application/json', body=json.dumps({'configured': True, 'operation': None}), headers=headers)
            page.wait_for_timeout(100)
            assert panel.get_by_text('Creation needs reconciliation', exact=True).count() == 1
            assert panel.locator('summary').count() == 0
            site.assert_no_page_errors(allow_console_warnings=['Service Worker registration blocked by Playwright'])


def test_ambiguous_creation_offers_reconciliation_without_another_create() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        request = project_request()
        _, _, created = json_request(storefront + '/api/request', method='POST', payload={'request': request, 'website': ''})
        status, _, _ = json_request(storefront + '/api/request', method='PATCH', payload={'id': created['id'], 'request': request, 'uploadedFiles': []})
        assert status == 200
        with SiteBrowser(viewport=(390, 844), service_workers='block') as site:
            page = site.page
            actions = []
            def recover(route):
                if route.request.method == 'GET':
                    body = {'configured': True, 'operation': {'state': 'needs_reconciliation', 'provider': None}}
                else:
                    command = route.request.post_data_json
                    actions.append(command['action'])
                    assert command['action'] == 'reconcile'
                    body = {'operation': {'state': 'draft', 'provider': {'number': '3DP-example', 'status': 'draft', 'balanceCents': 15192, 'editorUrl': 'https://app.invoicing.co/#/invoices/invoice123/edit'}}}
                route.fulfill(status=200, content_type='application/json', body=json.dumps(body), headers={'Access-Control-Allow-Origin': operator, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'})
            page.route('**/api/operator-work?resource=invoices*', recover)
            page.goto(operator, wait_until='networkidle')
            page.locator('#work-list .work-row').click()
            panel = page.get_by_role('region', name='Invoice drafts')
            panel.get_by_text('Creation needs reconciliation', exact=True).wait_for()
            assert panel.get_by_role('button', name='Confirm and create draft').count() == 0
            assert actions == []
            panel.get_by_role('button', name='Reconcile invoice', exact=True).click()
            panel.get_by_text('Draft ready for review', exact=True).wait_for()
            assert actions == ['reconcile']
            site.assert_no_page_errors(allow_console_warnings=['Service Worker registration blocked by Playwright'])
