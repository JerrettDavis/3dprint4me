from __future__ import annotations

import json

from tests.support.operator_harness import running_operator_workspace
from tests.support.server import request


def test_workspace_hosts_private_operator_shell_and_loopback_session() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        status, _, body = request(operator + "/")
        assert status == 200
        assert b"Work inbox" in body
        status, headers, body = request(operator + "/config.json")
        assert status == 200
        assert headers["Cache-Control"] == "no-store"
        assert json.loads(body)["apiBase"] == storefront
        status, _, body = request(storefront + "/api/operator-session", headers={"Origin": operator})
        assert status == 200
        assert json.loads(body)["operator"]["role"] == "owner"
        assert request(storefront + "/operator/index.html")[0] == 404
