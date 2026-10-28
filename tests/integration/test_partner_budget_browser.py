"""Native mappings for all budget-week.feature scenarios; synthetic reviews only."""
import json
import subprocess
import queue
import threading
from contextlib import contextmanager
import pytest
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig


def reservations(workspace):
    sql="SELECT json_build_object('count',count(*),'total',COALESCE(sum(r.amount_cents),0)) FROM partner_budget_reservations r JOIN partner_program_weeks w ON w.id=r.program_week_id WHERE w.program_id='"+workspace['programId']+"'"
    result=subprocess.run(['docker','exec',workspace['fixture']['_container'],'psql','-U','postgres','-Atc',sql],check=True,capture_output=True,text=True,timeout=15)
    return json.loads(result.stdout)


@contextmanager
def held_program(workspace):
    process=subprocess.Popen(['docker','exec','-i',workspace['fixture']['_container'],'psql','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    ready=queue.Queue()
    def observe():
        for line in process.stdout:
            if line.strip()=='fixture-budget-lock':ready.put(True);return
    threading.Thread(target=observe,daemon=True).start()
    try:
        process.stdin.write("BEGIN; SELECT id FROM partner_programs WHERE id='"+workspace['programId']+"' FOR UPDATE; SELECT 'fixture-budget-lock';\n");process.stdin.flush()
        assert ready.get(timeout=10)
        yield
    finally:
        if process.poll() is None:
            process.stdin.write('ROLLBACK;\n');process.stdin.close()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


def test_native_budget_commit_within_cap():
    with reviewed_budget_workspace() as w:
        w['accept'](w['offer'](5000));w['accept'](w['offer'](6000),partner=0)
        rows=w['budgets']();assert len(rows)==1
        assert rows[0]['committed_cents']==11000 and rows[0]['cap_cents']-rows[0]['committed_cents']==9000
        assert reservations(w)=={'count':2,'total':11000}


def test_native_budget_parallel_acceptances_do_not_oversubscribe():
    with reviewed_budget_workspace() as w:
        offers=[w['offer'](15000,partner=n) for n in [0,1]]
        held=[]
        for page,gig in zip(w['pages'],offers):
            page.goto(w['origin']+'/gigs/'+gig['id'])
            page.get_by_role('combobox',name='Action',exact=True).select_option('accept')
            page.route('**/api/partner/v1/commands',lambda route:held.append(route))
            page.get_by_role('button',name='Save decision',exact=True).click()
        for _ in range(100):
            if len(held)==2:break
            w['owner'].wait_for_timeout(10)
        assert len(held)==2
        # Release both browser-origin requests before waiting for either response.
        with held_program(w):
            for route in held:route.continue_()
            blocked=False
            for _ in range(50):
                probe=subprocess.run(['docker','exec',w['fixture']['_container'],'psql','-U','postgres','-Atc',"SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%partner_programs%'"],check=True,capture_output=True,text=True,timeout=10)
                if int(probe.stdout.strip())>=2:blocked=True;break
                w['owner'].wait_for_timeout(20)
            assert blocked,'Both real acceptance transactions must be waiting before release'
        results=[]
        for page in w['pages']:
            page.wait_for_function("()=>!document.querySelector('#message').hidden")
            results.append(page.locator('#message').inner_text())
        assert sum('Offer accepted. Receipt' in text for text in results)==1
        assert sum('No additional budget is available' in text for text in results)==1
        assert w['budgets']()[0]['committed_cents']==15000
        assert reservations(w)=={'count':1,'total':15000}
        states=[w['read']('gig',offer['id'])['item']['status'] for offer in offers]
        assert sorted(states)==['accepted','offered']


@pytest.mark.parametrize('instant,monday',[
 ('2026-10-26T04:59:00Z','2026-10-19'),('2026-10-26T05:01:00Z','2026-10-26'),
 ('2026-11-02T05:59:00Z','2026-10-26'),('2026-11-02T06:01:00Z','2026-11-02')])
def test_native_budget_acceptance_uses_deterministic_central_monday(instant,monday):
    with reviewed_budget_workspace(clock=instant) as w:
        gig=w['offer'](5000);w['accept'](gig)
        assert w['read']('gig',gig['id'])['item']['authorizationWeek']==monday
        assert monday in w['pages'][0].locator('main').inner_text()
        assert str(w['budgets']()[0]['week_start_local']).startswith(monday)


def test_native_budget_reduced_cap_preserves_earned_obligations():
    with reviewed_budget_workspace() as w:
        gigs=[w['offer'](10000,partner=n) for n in [0,1]]
        for n,gig in enumerate(gigs):w['accept'](gig,partner=n)
        extra=w['offer'](1000)
        current=w['budgets']()[0]
        reduced=w['post']('program.week_cap',{'programId':w['programId'],'weekStart':'2026-10-26','capCents':10000,'expectedRevision':current['revision'],'reason':'Synthetic audited exception: preserve existing obligations; stop new authorization.'})
        assert reduced['committedCents']==20000 and reduced['remainingCents']==0
        w['accept'](extra,expected=False)
        earned=[finish_gig(w,gig,partner=n) for n,gig in enumerate(gigs)]
        assert sum(row['amountDueCents'] for row in earned)==20000
        assert sum(row['outstandingCents'] for row in earned)==20000
        assert all(row['status']=='payable' and row['paidCents']==0 for row in earned)
        assert reservations(w)=={'count':2,'total':20000}
        events=w['read']('audit')['items']
        assert any(row['action']=='program.week_cap_changed' and row['program_id']==w['programId'] for row in events)


def test_native_budget_sunset_blocks_new_acceptance_preserves_review_and_payment():
    with reviewed_budget_workspace(clock='2026-12-30T18:00:00Z') as w:
        gig=w['offer'](5000);extra=w['offer'](6000,partner=1);w['accept'](gig)
        w['fixture']['setClock']('2027-01-01T18:00:00Z')
        page=w['pages'][1];page.goto(w['origin']+'/gigs/'+extra['id'])
        page.get_by_role('combobox',name='Action',exact=True).select_option('accept')
        page.get_by_role('button',name='Save decision',exact=True).click()
        page.get_by_text('New engagement is unavailable until program reviews and activation are complete.',exact=True).wait_for()
        assert w['read']('gig',extra['id'])['item']['status']=='offered'
        payable=finish_gig(w,gig)
        paid=w['post']('payment.record',{'payableId':payable['id'],'amountCents':5000,'paymentReference':'SYNTHETIC-SUNSET-SETTLEMENT','method':'bank_transfer','occurredAt':'2027-01-01T18:00:00Z','verified':True})
        assert paid['paidCents']==5000 and paid['outstandingCents']==0
        assert w['read']('gig',gig['id'])['item']['status']=='paid'
        assert reservations(w)=={'count':1,'total':5000}
