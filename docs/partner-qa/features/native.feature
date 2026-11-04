Feature: native
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-033
  Scenario: partner browser cookie csrf idor and logout
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Reload the current page and revalidate its session"
    When "Activate page.locator('nav summary')"
    When "Activate Profile"
    When "Enter Display name 'Synthetic browser saved'"
    When "Activate Save profile"
    When "Enter Account code fixture['otherPartnerId']"
    When "Activate second.locator('nav summary')"
    When "Activate Sign out"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-034
  Scenario: partner fixture removes its container after child crash
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-035
  Scenario: business visits and specific contact permission persist privately
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/visits/new?gig=' + fixture['acceptedGigId']"
    When "Enter Business name 'Native business without contact'"
    When "Select Outcome 'accepted_material'"
    When "Select Permission to leave materials 'permission_received'"
    When "Enter Samples left '2'"
    When "Activate Submit visit"
    When "Reload the current page and revalidate its session"
    When "Enter Business name 'Native business with permission'"
    When "Confirm This person explicitly agreed to project follow-up."
    When "Enter Project follow-up purpose 'Consented printed sign discussion'"
    When "Enter Contact email 'native-consent@example.test'"
    When "Activate page.get_by_text('Correct contact details', exact=True)"
    When "Enter Contact email 'native-corrected@example.test'"
    When "Enter Project follow-up purpose 'Renewed permission for a printed sign replacement'"
    When "Confirm This person renewed permission for these contact details and purpose."
    When "Activate Save corrected contact"
    When "Activate Withdraw follow-up permission"
    When "Confirm I understand this removes the contact details from active records."
    When "Activate Delete contact details"
    When "Enter Business name 'Native explicit device draft'"
    When "Confirm I understand this business-only draft stays on this device and is deleted when I sign out."
    When "Activate Save business draft on this device"
    When "Activate Device drafts"
    When "Activate Send pending business drafts"
    When "Activate Recorded visits"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-036
  Scenario: browser replays 100 device drafts after lost committed response
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/visits/new?gig=' + fixture['acceptedGigId']"
    When "Enter Business name 'Native replay 0'"
    When "Confirm I understand this business-only draft stays on this device and is deleted when I sign out."
    When "Activate Save business draft on this device"
    When "Activate Device drafts"
    When "Activate Send pending business drafts"
    When "Reload the current page and revalidate its session"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-037
  Scenario: expired visit session hides the private form
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/visits/new?gig=' + fixture['acceptedGigId']"
    When "Enter Business name 'Native expired-session visit'"
    When "Confirm This person explicitly agreed to project follow-up."
    When "Enter Project follow-up purpose 'Consented project request'"
    When "Enter Contact email 'expired-private@example.test'"
    When "Activate Submit visit"
    When "Enter Business name 'Native draft retained after expiry'"
    When "Confirm I understand this business-only draft stays on this device and is deleted when I sign out."
    When "Activate Save business draft on this device"
    When "Activate Device drafts"
    When "Activate Send pending business drafts"
    When "Open origin + '/drafts'"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-038
  Scenario: partner counterproposal persists without accepting or changing fee
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/gigs/' + fixture['gigId']"
    When "Enter Proposed fee (USD) '12.34'"
    When "Enter Message to the owner 'Synthetic fee discussion <script>alert(1)</script>'"
    When "Activate Send counterproposal"
    When "Reload the current page and revalidate its session"
    When "Open origin + '/gigs/' + fixture['acceptedGigId']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-039
  Scenario: customer referral request records permission without creating a bonus
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Activate page.locator('nav summary')"
    When "Activate Referrals"
    When "Activate Sign out"
    When "Enter Account code fixture['otherPartnerId']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-040
  Scenario: owner console uses github binding and preserves obligations while paused
    When "Open owner + '/partners#programs'"
    When "Activate page.locator('#partner-clearance summary')"
    When "Enter Default weekly authorization (USD) '175.25'"
    When "Activate Save program controls"
    When "Reload the current page and revalidate its session"
    When "Open owner + '/partners'"
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/gigs/' + fixture['acceptedGigId']"
    When "Enter Reason or submission details 'Synthetic completed permitted introductions.'"
    When "Activate Submit work for review"
    When "Open owner + '/partners#gig/' + fixture['acceptedGigId']"
    When "Select Review action 'approve'"
    When "Enter Review reason 'Objective deliverables verified.'"
    When "Activate Record gig review"
    When "Select Review action 'make_payable'"
    When "Open origin + '/earnings'"
    When "Open origin + '/profile'"
    When "Open owner + '/partners#partners'"
    When "Activate access.locator('..').locator('summary')"
    When "Select Access change 'suspended'"
    When "Confirm I understand that this ends access and invalidates unused codes without changing amounts owed."
    When "Activate Apply access change"
    When "Activate Save profile"
    When "Confirm I verified the identity of this partner and understand that issuing a code replaces all unused codes."
    When "Activate Issue recovery code"
    When "Open origin + '/join'"
    When "Enter Invitation or recovery code token"
    When "Enter Choose a passphrase 'Synthetic restored partner passphrase'"
    When "Activate Set passphrase and continue"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-041
  Scenario: owner referral conversion requires settlement and awards once
    When "Open owner + '/partners#referrals'"
    When "Activate page.locator('#partner-clearance summary')"
    When "Select Consenting web request request_id"
    When "Enter Permission evidence reference 'Native private web request permission checked'"
    When "Confirm Customer opt-in for this referral code is verified."
    When "Confirm I verified this is an independent customer, not a participant purchase."
    When "Activate Record attribution"
    When "Select Attributed request attribution_id"
    When "Enter Settled amount (USD) '125.00'"
    When "Enter Settlement reference reference"
    When "Select Settlement method 'bank_transfer'"
    When "Enter Settled at (ISO 8601 with timezone) datetime.now(timezone.utc).isoformat()"
    When "Confirm form.get_by_label(label, exact=True)"
    When "Activate Record verified sale"
    When "Select Verified settlement evidence sale_id"
    When "Confirm The frozen qualification criteria and deadline are met."
    When "Confirm I reviewed self-referral, duplicate and collusion checks."
    When "Activate Award accepted bonus"
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/referrals'"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-042
  Scenario: owner lead review correction and withdrawal update live permission
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/visits/new?gig=' + fixture['acceptedGigId']"
    When "Enter Business name 'Native owner review business'"
    When "Confirm This person explicitly agreed to project follow-up."
    When "Enter Project follow-up purpose 'Requested project sign discussion'"
    When "Enter Contact email 'owner-review@example.test'"
    When "Activate Submit visit"
    When "Open fixture['ownerOrigin'] + '/partners#leads'"
    When "Enter Review reason 'Specific project interest and permission checked.'"
    When "Activate Record lead review"
    When "Activate owner.get_by_text('Correct contact or purpose', exact=True)"
    When "Enter Email 'owner-renewed@example.test'"
    When "Enter Project purpose 'Renewed permission for the replacement sign project'"
    When "Confirm Renewed purpose-specific permission was explicitly given for these corrected details."
    When "Activate Save corrected contact"
    When "Confirm I confirmed the requested suppression or deletion. Existing obligations remain unchanged."
    When "Activate Apply permission action"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-043
  Scenario: owner finance preserves payment evidence and durable csv after lost response
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/gigs/' + fixture['acceptedGigId']"
    When "Enter Reason or submission details 'Synthetic completed work for finance verification.'"
    When "Activate Submit work for review"
    When "Open owner + '/partners#gig/' + fixture['acceptedGigId']"
    When "Select Review action action"
    When "Enter Review reason 'Synthetic objective work reviewed.'"
    When "Activate Record gig review"
    When "Open owner + '/partners#finance'"
    When "Activate page.get_by_text('Record a settled payment', exact=True)"
    When "Enter Settled payment (USD) amount"
    When "Enter Payment reference reference"
    When "Enter Settled at (ISO 8601 with timezone) datetime.now(timezone.utc).isoformat()"
    When "Confirm I independently verified that this payment actually settled."
    When "Activate Record verified payment"
    When "Activate page.locator('.owner-payment-history > summary')"
    When "Activate form.locator('..').get_by_text('Record a confirmed returned transfer', exact=True)"
    When "Enter Nonsettlement reference 'NATIVE-RETURN-2'"
    When "Enter Reversed at (ISO 8601 with timezone) datetime.now(timezone.utc).isoformat()"
    When "Enter Reversal reason 'Synthetic bank confirmation of returned transfer.'"
    When "Confirm I verified nonsettlement or return of this original payment."
    When "Activate Record payment reversal"
    When "Activate page.get_by_text('Record an evidenced obligation adjustment', exact=True)"
    When "Enter Adjustment (USD, positive or negative) '2.00'"
    When "Enter Adjustment reason 'Additional externally documented obligation.'"
    When "Enter Resolution reference 'NATIVE-RESOLUTION-1'"
    When "Confirm form.get_by_label(label, exact=True)"
    When "Activate Record obligation adjustment"
    When "Open origin + '/gigs/' + referral_gig"
    When "Enter Reason or submission details 'Synthetic unsafe access; partial work needs resolution.'"
    When "Activate Stop unsafe work"
    When "Reload the current page and revalidate its session"
    When "Activate page.get_by_text('Reconcile accepted work', exact=True)"
    When "Enter Agreed obligation (USD) '5.00'"
    When "Enter Resolution reason 'Synthetic acknowledged safety resolution.'"
    When "Enter Resolution reference 'NATIVE-SAFETY-RESOLUTION'"
    When "Activate Record resolved obligation"
    When "Activate page.get_by_text('Create accounting CSV batch', exact=True)"
    When "Select Accounting basis 'cash'"
    When "Activate Create incremental CSV batch"
    When "Activate Download verified CSV"
    When "Activate Return to finance and batch history"
    When "Select Accounting basis basis"
    When "Open origin + '/earnings'"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-044
  Scenario: owner legal editor preserves versions comments and conflicting draft
    When "Open owner + '/partners#legal'"
    When "Activate Load bundled discussion drafts"
    When "Activate page.locator('[data-template=\"independent-marketing-services\"] a')"
    When "Select Clause anchor 'preamble'"
    When "Enter Reviewer or source attribution 'Synthetic counsel discussion'"
    When "Enter Clause concern 'Synthetic clarification needed before professional review.'"
    When "Activate Add clause concern"
    When "Activate page.locator('summary').filter(has_text='Edit latest revision')"
    When "Enter Markdown source updated"
    When "Enter Change reason 'Add the requested synthetic clarification.'"
    When "Activate Save new immutable revision"
    When "Enter Resolution 'Synthetic clarification recorded in this new revision.'"
    When "Activate Record comment resolution"
    When "Activate Mark revision in review"
    When "Select Compare with revision old_id"
    When "Activate Compare saved revisions"
    When "Enter Markdown source unsaved"
    When "Enter Change reason 'Synthetic stale editor attempt.'"
    When "Activate Compare unsaved text with latest revision"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-045
  Scenario: owner professional package decisions and returned feedback
    When "Open owner + '/partners#legal'"
    When "Activate Load bundled discussion drafts"
    When "Activate page.locator('[data-template=\"independent-marketing-services\"] a')"
    When "Activate page.locator('summary').filter(has_text='Edit latest revision')"
    When "Enter Markdown source '# Synthetic services terms\\n## [IMS-04] Scope\\nSynthetic voluntary introductions in a disposable browser test.\\n'"
    When "Confirm Mark this text ready for reviewed issuance (does not grant approval)"
    When "Enter Change reason 'Synthetic professional review journey only.'"
    When "Activate Save new immutable revision"
    When "Activate page.get_by_text('Create professional review package', exact=True)"
    When "Confirm form.locator('[name=versionIds]')"
    When "Activate Add named reviewer"
    When "Enter Reviewer name name"
    When "Select Professional role role"
    When "Confirm row.get_by_label(scope, exact=True)"
    When "Enter Grant expires at (ISO 8601 with timezone) expires"
    When "Enter Private factual brief and review questions 'Synthetic facts. No actual professional decision or engagement.'"
    When "Confirm I checked redaction, private facts and permission to share this package."
    When "Activate Create private signed package"
    When "Activate Download signed ZIP (unencrypted)"
    When "Enter Handoff passphrase (20 to 1024 UTF-8 bytes) secret"
    When "Enter Repeat handoff passphrase secret"
    When "Confirm I saved the passphrase separately and will share it through the agreed trusted channel."
    When "Activate Encrypt package on this device"
    When "Activate Download encrypted review file"
    When "Open (ROOT / 'operator' / 'review-reader.html').as_uri()"
    When "Enter Review passphrase password"
    When "Enter Independently trusted signing fingerprint fingerprint"
    When "Activate Unlock and verify locally"
    When "Activate offline.locator('#result a[download$=\".md\"]').first"
    When "Enter Return passphrase (20 to 1024 UTF-8 bytes) return_secret"
    When "Enter Repeat return passphrase return_secret"
    When "Confirm form.get_by_role('checkbox')"
    When "Activate Encrypt returned DOCX locally"
    When "Activate Download encrypted DOCX return"
    When "Enter Return passphrase (20 to 1024 UTF-8 bytes) 'Changed private return passphrase 2026!'"
    When "Activate Lock and clear private view"
    When "Select Returned source version version_id"
    When "Select Returning named reviewer '0'"
    When "Enter Return passphrase (encrypted returns only) return_secret"
    When "Confirm I confirmed the returning reviewer identity through the agreed private channel."
    When "Activate Import untrusted feedback"
    When "Activate Return to the source review package"
    When "Select Reviewed source version version_id"
    When "Select Named reviewer and scope str(grant)"
    When "Select Professional decision choice"
    When "Enter Evidence reference reference"
    When "Enter Reviewed at (ISO 8601 with timezone) datetime.now(timezone.utc).isoformat()"
    When "Confirm I verified the reviewer identity and this decision through the agreed private channel."
    When "Activate Record professional decision"
    When "Open owner + '/partners#legal/version/' + version_id"
    When "Activate Publish reviewed revision"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-046
  Scenario: owner scoped bindings typed issue ack and immutable history
    When "Open owner + '/partners#programs'"
    When "Reload the current page and revalidate its session"
    When "Activate page.get_by_text('Bind reviewed agreement and outreach policy', exact=True)"
    When "Select form.get_by_role('combobox', name=label, exact=True) version['versionId']"
    When "Activate Save reviewed version bindings"
    When "Confirm Enable new work after all clearance checks pass"
    When "Activate Save program controls"
    When "Activate Workspace menu"
    When "Activate Issued agreements"
    When "Select Program program_id"
    When "Select Active partner fixture['partnerId']"
    When "Select Exact reviewed source version['versionId']"
    When "Enter partner name (private-person-name) 'Synthetic typed partner'"
    When "Enter fee usd (USD) '12.34'"
    When "Enter service date (date) '2026-10-25'"
    When "Enter count (integer) '3'"
    When "Enter email (email) 'synthetic@example.test'"
    When "Enter notes (multiline) 'Private objective scope.\\n*Literal* note.'"
    When "Confirm I reviewed the typed values and will issue this exact saved version to this partner."
    When "Activate Issue frozen agreement copy"
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/gigs/' + fixture['gigId']"
    When "Activate Accept offer"
    When "Open origin + '/agreements'"
    When "Confirm I have read this exact issued version."
    When "Activate Record read acknowledgment"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-047
  Scenario: prepared visit survives offline cold reopen and manual replay
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Open origin + '/visits/new?gig=' + fixture['acceptedGigId']"
    When "Activate Prepare this gig for offline business drafts"
    When "Open origin + '/drafts'"
    When "Enter Account code for device drafts fixture['partnerId']"
    When "Activate Open device drafts"
    When "Activate Record another business visit"
    When "Enter Business name 'Native cold offline business'"
    When "Confirm page.locator('#device-permission')"
    When "Activate Save business draft on this device"
    When "Reload the current page and revalidate its session"
    When "Activate Send pending business drafts"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-048
  Scenario: late login cookie after other tab logout is revoked
    When "Open origin"
    When "Enter Account code fixture['partnerId']"
    When "Enter Passphrase fixture['password']"
    When "Activate Sign in"
    When "Activate Sign out"
    When "Reload the current page and revalidate its session"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-049
  Scenario: optional activity partner can track and delete own elapsed record
    When "Open origin + '/activity'"
    When "Activate Start optional record"
    When "Activate Pause"
    When "Reload the current page and revalidate its session"
    When "Activate Resume"
    When "Activate Stop"
    When "Open fixture['ownerOrigin'] + '/partners'"
    When "Activate Delete record"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-050
  Scenario: optional activity work submission never requires a timer
    When "Open origin + '/gigs/' + fixture['acceptedGigId']"
    When "Enter Reason or submission details 'Synthetic agreed visit completed without optional tracking.'"
    When "Activate Submit work for review"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-051
  Scenario: optional activity gig and visit screens never request geolocation
    When "Activate page.locator('nav summary')"
    When "Activate Gigs"
    When "Activate page.locator('a[href=\"/gigs/' + fixture['acceptedGigId'] + '\"]')"
    When "Activate Record a business visit"
    When "Enter Business name 'Synthetic map-free visit'"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-052
  Scenario: http read results match published api schemas
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

