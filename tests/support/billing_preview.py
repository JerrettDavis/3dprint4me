"""Synthetic private billing facts for repeatable UI review."""
def billing_preview():
    return {'version': 1, 'revision': 1,
            'sync': {'status': 'current', 'lastSuccessfulAt': '2026-11-24T18:00:00Z'},
            'counts': {'needsInvoicing': 1, 'draft': 1, 'viewed': 2, 'paid': 1, 'overdue': 1},
            'totals': [{'currency': 'USD', 'outstandingCents': 3500, 'overdueCents': 3500, 'paidCents': 5426}],
            'items': [{'id': 'DemoInvoice01', 'number': 'DEMO-001', 'status': 'paid', 'currency': 'USD', 'totalCents': 5426, 'balanceCents': 0,
                       'paidCents': 5426, 'dueDate': '2026-11-20', 'viewed': True, 'opened': True, 'overdue': False},
                      {'id': 'DemoInvoice02', 'number': 'DEMO-002', 'status': 'draft', 'currency': 'USD', 'totalCents': 15192, 'balanceCents': 0,
                       'paidCents': 0, 'dueDate': None, 'viewed': False, 'opened': False, 'overdue': False},
                      {'id': 'DemoInvoice03', 'number': 'DEMO-003', 'status': 'sent', 'currency': 'USD', 'totalCents': 3500, 'balanceCents': 3500,
                       'paidCents': 0, 'dueDate': '2026-11-20', 'viewed': True, 'opened': False, 'overdue': True}],
            'needsInvoicing': [{'workId': 'work_demonstration'}],
            'tax': {'configured': True, 'periods': [{'id': 'ok-sales-2026-11', 'startsOn': '2026-11-01', 'endsOn': '2026-11-30', 'dueDate': '2026-12-21', 'submitted': False, 'paid': False}]},
            'settings': {'timeZone': 'America/Chicago', 'notificationsEnabled': True, 'taxSchedule': None}, 'delivery': []}

def install_billing_preview(page, operator):
    data = billing_preview()
    headers = {'access-control-allow-origin': operator, 'access-control-allow-credentials': 'true'}
    def handle(route):
        if 'resource=billing' not in route.request.url:
            return route.fallback()
        route.fulfill(headers=headers, json=data)
    page.route('**/api/operator-work?**', handle)
