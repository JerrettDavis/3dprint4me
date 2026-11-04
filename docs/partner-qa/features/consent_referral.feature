Feature: consent referral
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-014
  Scenario: business visit creates no personal contact or followup queue
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-015
  Scenario: explicit project permission records exact consent version before owner review
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-016
  Scenario: unconsented email is rejected without contact audit or notification side effects
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-017
  Scenario: withdrawn permission suppresses owner contact and cannot be requalified
    When "Open w['origin'] + '/visits'"
    When "Activate Withdraw follow-up permission"
    When "Open w['fixture']['ownerOrigin'] + '/partners#leads'"
    When "Reload the current page and revalidate its session"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-018
  Scenario: qualified lead bonus survives different device duplicate evidence once
    When "Open w['fixture']['ownerOrigin'] + '/partners#referrals'"
    When "Select Qualification evidence qualification['id']"
    When "Confirm The frozen qualification criteria and deadline are met."
    When "Confirm I reviewed self-referral, duplicate and collusion checks."
    When "Activate Award accepted bonus"
    When "Open w['origin']"
    When "Enter Account code w['accounts'][0]['id']"
    When "Enter Passphrase 'Synthetic budget partner private passphrase'"
    When "Activate Sign in"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-019
  Scenario: original twenty dollar sale bonus survives new ten dollar policy
    When "Open w['origin'] + '/referrals'"
    When "Reload the current page and revalidate its session"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

