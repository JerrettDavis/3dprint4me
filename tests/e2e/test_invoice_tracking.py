"""Private billing view with synthetic provider facts; never changes real invoices."""
from pathlib import Path
import platform
import pytest
from playwright.sync_api import sync_playwright, expect
from tests.support.operator_harness import running_operator_workspace

@pytest.mark.parametrize('width,scheme', [(1440, 'light'), (390, 'dark')])
def test_owner_billing_states_and_private_tax_actions(width, scheme):
    with sync_playwright() as p, running_operator_workspace() as (_, operator, _):
        browser = p.chromium.launch(**({'channel': 'msedge'} if platform.system() == 'Windows' else {}), headless=True)
        context = browser.new_context(viewport={'width': width, 'height': 900}, color_scheme=scheme, reduced_motion='reduce', service_workers='block')
        page = context.new_page()
        headers = {'access-control-allow-origin': operator, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS'}
        data = {'version': 1, 'revision': 1, 'sync': {'status': 'stale', 'lastSuccessfulAt': '2026-11-24T18:00:00Z'},
                'counts': {'paid': 1, 'draft': 1, 'needsInvoicing': 1, 'overdue': 1}, 'totals': [],
                'items': [{'id': 'Invoice123', 'number': 'DEMO-PAID', 'status': 'paid', 'currency': 'USD', 'totalCents': 5426, 'balanceCents': 0, 'paidCents': 5426, 'dueDate': '2026-11-20', 'viewed': True, 'opened': True, 'overdue': False, 'editorUrl': 'https://invoicing.co/#/invoices/Invoice123/edit'},
                          {'id': 'Invoice456', 'number': 'DEMO-DRAFT', 'status': 'draft', 'currency': 'USD', 'totalCents': 15192, 'balanceCents': 0, 'paidCents': 0, 'dueDate': None, 'viewed': False, 'opened': False, 'overdue': False, 'editorUrl': 'https://invoicing.co/#/invoices/Invoice456/edit'}],
                'needsInvoicing': [{'workId': 'work_demonstration', 'url': 'https://work.3dprint4.me/work/work_demonstration'}],
                'tax': {'configured': True, 'periods': [{'id': 'ok-sales-2026-11', 'startsOn': '2026-11-01', 'endsOn': '2026-11-30', 'dueDate': '2026-12-21', 'submitted': False, 'paid': False}]},
                'settings': {'timeZone': 'America/Chicago', 'notificationsEnabled': False, 'taxSchedule': None}}
        commands = []
        def route_billing(route):
            if 'resource=billing' not in route.request.url:
                return route.fallback()
            if route.request.method == 'POST':
                command = route.request.post_data_json
                commands.append(command)
                if command['action'] == 'tax-acknowledge':
                    data['tax']['periods'][0][command['kind']] = True
                return route.fulfill(headers=headers, json={'revision': 2})
            route.fulfill(headers=headers, json=data)
        page.route('**/api/operator-work?**', route_billing)
        page.goto(operator)
        page.get_by_role('button', name='Billing', exact=True).click()
        dialog = page.get_by_role('dialog', name='Billing', exact=True)
        expect(dialog.get_by_text('Stale', exact=True)).to_be_visible()
        expect(dialog.get_by_text('DEMO-PAID', exact=True)).to_be_visible()
        expect(dialog.get_by_text('DEMO-DRAFT', exact=True)).to_be_visible()
        expect(dialog.get_by_text('Due 2026-12-21', exact=True)).to_be_visible()
        page.screenshot(path=f'screenshots/operator-billing-{width}-{scheme}.png', full_page=True)
        dialog.get_by_text('Acknowledge filing', exact=True).click()
        dialog.get_by_label('Filing date', exact=True).fill('2026-11-24')
        dialog.get_by_label('Filing confirmation reference', exact=True).fill('DEMO filing confirmation')
        dialog.get_by_role('button', name='Confirm filing', exact=True).click()
        expect(dialog.get_by_text('Filing acknowledged', exact=True)).to_be_visible()
        expect(dialog.get_by_text('Acknowledge payment', exact=True)).to_be_visible()
        assert commands[0]['kind'] == 'submitted'
        assert commands[0]['revision'] == 1
        dialog.get_by_label('Invoice filter').select_option('paid')
        expect(dialog.get_by_text('DEMO-DRAFT', exact=True)).not_to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        dialog.get_by_role('button', name='Close billing', exact=True).click()
        expect(page.get_by_role('button', name='Billing', exact=True)).to_be_focused()
        context.close()
        browser.close()
