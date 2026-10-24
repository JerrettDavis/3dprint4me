"""Owner forecast presentation, scope and escaped labels; native tests prove money."""
import json
import pytest
from urllib.parse import urlparse,parse_qs
from tests.e2e.test_partner_owner import install_owner_fixture,PROGRAM
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser


def install_forecast_fixture(page,*,label='Synthetic forecast <img src=x onerror=alert(1)>'):
    install_owner_fixture(page);requests=[]
    amounts={'authorizedMaximumCents':6000,'offeredMaximumCents':9000,'pendingFeeCents':0,'contingentBonusCents':1000,'obligationCents':5000,'paidCents':2000,'outstandingCents':3000,'overpaidCents':0,'remainingExposureCents':4000,'potentialTotalCents':6000,'unfundedExposureCents':0}
    item={'programId':PROGRAM,'label':label,**amounts,'weeks':[{'weekId':'forecast-week','weekStart':'2026-10-26','capCents':1000,**{**amounts,'offeredMaximumCents':0}}]}
    def handle(route):
        params=parse_qs(urlparse(route.request.url).query)
        if params.get('resource')!=['forecasts']:route.fallback();return
        requests.append(params.get('programId',[None])[0])
        route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[item],'asOf':'2026-10-26T12:00:00.000Z','method':'recorded_commitment_upper_bound'}))
    page.route('**/api/operator-partners*',handle)
    return requests


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_owner_forecast_separates_spend_exposure_and_lower_caps_with_program_scope(width,theme):
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page;requests=install_forecast_fixture(page)
        page.goto(origin+'/partners#forecasts')
        page.get_by_role('heading',name='Spend forecasts',exact=True).wait_for(timeout=3000)
        program=page.locator('[data-forecast-program="'+PROGRAM+'"]')
        assert 'Synthetic forecast <img src=x onerror=alert(1)>' in program.inner_text()
        assert page.locator('#owner-content img').count()==0
        assert '$20.00' in program.inner_text() and '$40.00' in program.inner_text() and '$60.00' in program.inner_text()
        week=page.locator('[data-forecast-week="forecast-week"]')
        assert '2026-10-26' in week.inner_text() and '$10.00' in week.inner_text()
        assert 'Unaccepted offers are excluded' in page.locator('main').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        with page.expect_response(lambda r:'resource=forecasts' in r.url and 'programId='+PROGRAM in r.url):
            page.get_by_role('combobox',name='Forecast program',exact=True).select_option(PROGRAM)
        page.get_by_role('heading',name='Spend forecasts',exact=True).wait_for()
        assert requests==[None,PROGRAM]
        assert not site.page_errors
