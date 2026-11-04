Feature: qa
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-060
  Scenario: qa isolated lifecycle and canonical stub denial
    When "Open fixture['ownerOrigin'] + '/partners/qa#programs'"
    When "Activate Create synthetic QA run"
    When "Open origin + '/qa/join'"
    When "Enter Invitation or recovery code invite['token']"
    When "Enter Choose a passphrase 'Synthetic QA private passphrase'"
    When "Activate Set passphrase and continue"
    When "Activate Workspace menu:"
    When "Activate Agreements"
    When "Activate Download exact text"
    When "Confirm I have read this exact issued version."
    When "Activate Record read acknowledgment"
    When "Open origin + '/qa/gigs/' + gig['id']"
    When "Activate Accept offer"
    When "Open fixture['ownerOrigin'] + '/partners/qa#referrals'"
    When "Open origin + '/qa/visits/new?gig=' + gig['id']"
    When "Enter Business name 'QA fictional business ' + str(number)"
    When "Select Outcome 'accepted_material'"
    When "Select Permission to leave materials 'permission_received'"
    When "Enter Samples left '1'"
    When "Activate Submit visit"
    When "Enter Reason or submission details 'QA ten simulated permitted visits complete.'"
    When "Activate Submit work for review"
    When "Open origin + '/qa/earnings'"
    When "Activate Retire selected QA run"
    When "Reload the current page and revalidate its session"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

