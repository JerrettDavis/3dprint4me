"""Task, navigation and focus contracts for the private partner workspace."""
import json
import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support.partner_harness import running_partner_shell
from tests.e2e.test_partner_shell import install_offer_fixture, GIG_ID
from tests.e2e.test_partner_visits import visit_fixture, GIG


def test_mobile_menu_reaches_all_areas_and_tracks_deep_parent_and_history():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        install_offer_fixture(page)
        page.goto(origin + '/gigs/' + GIG_ID)
        page.get_by_role('heading', name='Synthetic introductions', exact=True).wait_for()
        menu = page.get_by_role('button', name='Workspace menu: Gigs', exact=True)
        assert menu.get_attribute('aria-expanded') == 'false'
        menu.click()
        assert page.get_by_role('navigation').locator('[aria-current=page]').inner_text() == 'Gigs'
        assert page.get_by_role('navigation').get_by_role('link').count() == 9
        page.get_by_role('navigation').get_by_role('link', name='Profile', exact=True).click()
        page.get_by_role('heading', name='Your profile', exact=True).wait_for()
        page.wait_for_function('() => document.activeElement.id === "main"')
        assert page.title() == 'Your profile · Partners · 3dprint4.me'
        assert page.get_by_role('button', name='Workspace menu: Profile').get_attribute('aria-expanded') == 'false'
        page.go_back()
        page.get_by_role('heading', name='Synthetic introductions', exact=True).wait_for()
        page.wait_for_function('() => document.activeElement.id === "main"')
        assert page.title() == 'Synthetic introductions · Partners · 3dprint4.me'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_resizing_to_mobile_keeps_focus_on_visible_menu_control():
    with running_partner_shell() as origin, SiteBrowser(viewport=(1440, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        install_offer_fixture(page)
        page.goto(origin + '/gigs/' + GIG_ID)
        link = page.get_by_role('navigation').get_by_role('link', name='Profile', exact=True)
        link.focus()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_function('() => !document.querySelector("nav details").open')
        assert page.evaluate('document.activeElement.tagName') == 'SUMMARY'
        assert page.locator('nav summary').is_visible()


def test_resizing_to_desktop_moves_only_disappearing_menu_focus_to_current_destination():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        install_offer_fixture(page)
        page.goto(origin + '/gigs/' + GIG_ID)
        page.locator('nav summary').focus()
        page.set_viewport_size({'width': 1440, 'height': 844})
        page.wait_for_function('() => document.querySelector("nav details").open')
        assert page.evaluate('document.activeElement.getAttribute("aria-current")') == 'page'
        assert page.evaluate('document.activeElement.textContent') == 'Gigs'
        # A viewport change must not take focus away from the actual task.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.get_by_label('Reason or submission details', exact=True).focus()
        page.set_viewport_size({'width': 1440, 'height': 844})
        page.wait_for_function('() => document.querySelector("nav details").open')
        assert page.evaluate('document.activeElement.name') == 'reason'


@pytest.mark.parametrize('action,label', [('accept','Accept offer'), ('decline','Decline offer')])
def test_explicit_gig_choice_preserves_command_and_exact_retry(action, label):
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        install_offer_fixture(page)
        requests = []
        def respond(route):
            requests.append(route.request.post_data_json)
            route.fulfill(status=503, content_type='application/json', body='{"error":"Try again later"}')
        page.route('**/api/partner/v1/commands', respond)
        page.goto(origin + '/gigs/' + GIG_ID)
        page.get_by_role('button', name=label, exact=True).click()
        page.get_by_text('The partner service is temporarily unavailable. Try again later.', exact=True).wait_for()
        page.get_by_role('button', name=label, exact=True).click()
        page.wait_for_function('() => !document.querySelector("#gig-action button").disabled')
        assert requests[0] == requests[1]
        assert requests[0]['action'] == 'gig.' + action
        assert requests[0]['input'] == {'gigId': GIG_ID, 'expectedRevision': 1}
        assert page.get_by_label('Action', exact=True).count() == 0


def test_grouped_visit_keeps_unavailable_no_material_outcome_and_business_only_submission():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        commands = visit_fixture(page)
        page.goto(origin + '/visits/new?gig=' + GIG)
        page.get_by_role('group', name='Business visit', exact=True).wait_for()
        assert page.get_by_role('group', name='Optional project follow-up', exact=True).is_visible()
        page.get_by_label('Business name', exact=True).fill('Synthetic closed business')
        page.get_by_role('button', name='Submit visit', exact=True).click()
        page.get_by_text('Visit recorded.', exact=True).wait_for()
        assert commands[-1]['input']['outcome'] == 'unavailable'
        assert commands[-1]['input']['placement'] == 'none'
        assert commands[-1]['input']['sampleCount'] == 0
        assert commands[-1]['input']['consent'] is False
        assert 'contact' not in commands[-1]['input']


def test_late_navigation_cannot_take_focus_or_title_from_current_profile():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        install_offer_fixture(page)
        held = []
        page.route('**/api/partner/v1/gig?*', lambda route: held.append(route))
        page.goto(origin + '/gigs')
        page.get_by_role('heading', name='Your gigs', exact=True).wait_for()
        # Start slow navigation without replacing the document.
        page.evaluate("() => {const a=document.createElement('a');a.href='/gigs/" + GIG_ID + "';document.body.append(a);a.click();a.remove();}")
        page.locator('nav summary').click()
        page.get_by_role('navigation').get_by_role('link', name='Profile', exact=True).click()
        page.get_by_label('Display name', exact=True).fill('Keep this edit and focus')
        page.get_by_label('Display name', exact=True).focus()
        assert len(held) == 1
        held[0].fulfill(status=503, content_type='application/json', body='{}')
        page.wait_for_timeout(100)
        assert page.title() == 'Your profile · Partners · 3dprint4.me'
        assert page.get_by_label('Display name', exact=True).input_value() == 'Keep this edit and focus'
        assert page.evaluate('document.activeElement.name') == 'displayName'
        assert page.locator('#message').is_hidden()


@pytest.mark.parametrize('state,labels', [
    ('accepted', ['Submit work for review', 'Request cancellation', 'Stop unsafe work']),
    ('changes_requested', ['Submit work for review', 'Stop unsafe work']),
    ('payable', ['Raise a dispute']),
])
def test_state_specific_decisions_remain_available_with_distinct_retry_keys(state, labels):
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        page.set_default_timeout(3000)
        item, _ = install_offer_fixture(page)
        item.update(status=state, acceptedAt='2026-11-01T12:00:00Z')
        requests = []
        def fail(route):
            requests.append(route.request.post_data_json)
            route.fulfill(status=409, content_type='application/json', body='{"error":"Synthetic review conflict"}')
        page.route('**/api/partner/v1/commands', fail)
        page.goto(origin + '/gigs/' + GIG_ID)
        for label in labels:
            page.get_by_label('Reason or submission details', exact=True).fill('Synthetic task decision details')
            page.get_by_role('button', name=label, exact=True).click()
            page.get_by_text('Synthetic review conflict', exact=True).wait_for()
        assert len({command['key'] for command in requests}) == len(labels)
        assert all(command['input']['reason'] == 'Synthetic task decision details' for command in requests)
        assert page.get_by_label('Action', exact=True).count() == 0
