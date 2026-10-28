"""Deterministic regression coverage for disposable Docker cleanup."""
import json
import subprocess
from unittest.mock import Mock
import pytest
from tests.support.partner_container_cleanup import cleanup_partner_container

NAME = '3dprint4me-partner-browser-1234abcd'
ID = 'a' * 64

def result(code=0, stderr='', details=None):
    return subprocess.CompletedProcess([], code, json.dumps([details or {'Id': ID, 'Name': '/' + NAME, 'Config': {'Labels': {'3dprint4me.purpose': 'partner-browser'}}}]), stderr)

def missing():
    return result(1, 'Error: No such object: ' + ID)

def run_cleanup(responses):
    run = Mock(side_effect=responses)
    cleanup_partner_container(NAME, run=run, sleep=Mock(), attempts=3)
    return run

def test_disappears_between_inspect_and_remove():
    run = run_cleanup([result(), result(1, 'Error response from daemon: No such container: ' + ID), missing()])
    assert run.call_args_list[1].args[0] == ['docker', 'rm', '--force', ID]
    assert run.call_args_list[2].args[0] == ['docker', 'inspect', ID]

def test_removal_in_progress_waits_for_confirmed_absence():
    run = run_cleanup([result(), result(1, 'Error response from daemon: removal of container ' + ID + ' is already in progress'), result(), missing()])
    assert len(run.call_args_list) == 4
    assert all(call.args[0][-1] == ID for call in run.call_args_list[1:])

def test_removal_in_progress_is_bounded():
    with pytest.raises(RuntimeError, match='did not disappear'):
        run_cleanup([result(), result(1, 'removal of container ' + ID + ' is already in progress'), result(), result(), result()])

@pytest.mark.parametrize('responses', [
    [result(1, 'Cannot connect to the Docker daemon')],
    [result(), result(1, 'permission denied')],
    [result(), result(1, 'No such container: ' + ID), result(1, 'daemon unavailable')],
])
def test_real_docker_errors_fail(responses):
    with pytest.raises(RuntimeError):
        run_cleanup(responses)

@pytest.mark.parametrize('field,value', [('Name', '/unrelated'), ('Config', {'Labels': {'3dprint4me.purpose': 'unrelated'}}), ('Id', 'invalid')])
def test_unowned_or_invalid_container_cannot_be_removed(field, value):
    details = json.loads(result().stdout)[0]
    details[field] = value
    run = Mock(return_value=result(details=details))
    with pytest.raises(AssertionError):
        cleanup_partner_container(NAME, run=run)
    assert run.call_count == 1

def test_invalid_requested_name_cannot_be_inspected():
    run = Mock()
    with pytest.raises(AssertionError):
        cleanup_partner_container('unrelated', run=run)
    run.assert_not_called()

def test_already_absent_container_needs_no_remove():
    run = run_cleanup([result(1, 'Error: No such object: ' + NAME)])
    assert run.call_count == 1

def test_successful_remove_needs_no_retry():
    run = run_cleanup([result(), result()])
    assert run.call_args_list[1].args[0] == ['docker', 'rm', '--force', ID]
    assert run.call_count == 2

def test_missing_object_message_does_not_hide_other_errors():
    with pytest.raises(RuntimeError):
        run_cleanup([result(1, 'Error: No such object: ' + NAME + '\nCannot connect to the Docker daemon')])

def test_removal_progress_message_does_not_hide_other_errors():
    with pytest.raises(RuntimeError, match='Could not remove'):
        run_cleanup([result(), result(1, 'removal of container ' + ID + ' is already in progress\npermission denied')])
