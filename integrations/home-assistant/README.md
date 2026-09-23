# Home Assistant work peek

This read-only package polls `GET https://3dprint4.me/api/home-assistant-work` every 60 seconds. It shows active work counts and up to 20 active summaries. The latest-created marker covers **all** work statuses, including completed or declined work that is absent from the active list. Links open the authenticated [operator inbox](https://work.3dprint4.me/); Home Assistant cannot update work.

## Install

1. Generate a distinct machine token with `openssl rand -base64 48`. Set the token as the server-only `HOME_ASSISTANT_TOKEN` in the 3dprint4.me API deployment. Keep it out of `public/`, `operator/`, browser bundles, and this repository.
2. Copy `package.yaml` into the Home Assistant configuration directory, for example as `packages/three_d_print_work.yaml`. Add this to `configuration.yaml` under its existing `homeassistant:` key (or create that key):

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

   If you already include packages, keep that configuration and place the file in its included directory. The package file starts at `rest:`; do not indent it under another key.
3. In Home Assistant `secrets.yaml`, add the exact key below. Replace the placeholder with the same token configured on the API. The `Bearer ` prefix and following space are required:

   ```yaml
   three_d_print_work_authorization: "Bearer REPLACE_WITH_GENERATED_TOKEN"
   ```

4. Run Home Assistant's **Check configuration** action, then restart Home Assistant. Confirm `sensor.three_d_print_work` and the five derived sensors appear in Developer Tools → States. The REST sensor holds the `items` list as an attribute so its entity state stays small.
5. Create a YAML dashboard or open a dashboard's **Raw configuration editor**, then paste the contents of `dashboard.yaml` as its complete configuration. The dashboard uses only built-in entities and Markdown cards. Sign in to the operator app when following a work link.

The baseline alert is Home Assistant's persistent notification `three_d_print_new_work`. The first successful poll establishes the latest-created marker and fills the dashboard without alerting; an alert requires a prior valid work marker and a different new valid marker. It deep-links directly from the validated marker, so it still works when the newest work has left the active list. Repeated polls of the same marker do not alert. After an outage or restart, a transition from `unavailable` does not alert.

## Optional phone delivery

The persistent notification appears inside Home Assistant. For phone push, add this action after the `persistent_notification.create` action in the package automation's `actions:` list:

```yaml
- action: notify.mobile_app_owner_phone
  data:
    title: New 3D print work
    message: New work is available. Open it in the operator inbox.
    data:
      url: "https://work.3dprint4.me/work/{{ trigger.to_state.state }}"
```

`notify.mobile_app_owner_phone` is illustrative. Replace it with the actual `notify.mobile_app_*` target exposed by your Home Assistant Companion App. The URL is a fixed operator work path using the same validated trigger ID; it performs no write.

## Operation and removal

- An HTTP **401** means the Authorization header is missing, malformed, or does not match the configured token. Verify the exact `Bearer <token>` value on both sides without printing it in logs. An HTTP **503** means the API token is unconfigured/too short or the snapshot service is unavailable. Check the API deployment and private database health; Home Assistant will retry at the next poll.
- Rotate the token by generating a new value, updating the API's `HOME_ASSISTANT_TOKEN` and the Home Assistant secret in one maintenance window, redeploying/restarting both sides, and checking that the sensor resumes updating. Expect temporary 401s while the two values differ.
- The snapshot excludes customer names, contact details, request descriptions, private files, notes, events, and revisions. It includes project titles in the REST sensor's `items` attribute, even though the supplied dashboard links by work ID. Protect Home Assistant backups, logs, and account access accordingly. Do not share the package secret or snapshots publicly.
- To remove the integration, remove the dashboard, delete the installed package file and `three_d_print_work_authorization` secret, validate and restart Home Assistant, and remove `HOME_ASSISTANT_TOKEN` from the API deployment. Dismiss the persistent notification if it remains.

Configuration syntax follows Home Assistant's [packages](https://www.home-assistant.io/docs/configuration/packages), [RESTful](https://www.home-assistant.io/integrations/rest/), [template](https://www.home-assistant.io/integrations/template/), [Markdown card](https://www.home-assistant.io/dashboards/markdown), and [persistent notification](https://www.home-assistant.io/integrations/persistent_notification/) documentation.
