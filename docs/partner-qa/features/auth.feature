Feature: auth
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-001
  Scenario: auth initial enrollment without github has private host cookie
    When "Open w['origin']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-002
  Scenario: auth invitation replay from another browser is denied
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-003
  Scenario: auth revocation interrupts live profile mutation
    When "Open w['origin'] + '/profile'"
    When "Enter Display name 'Must not persist after revocation'"
    When "Activate Save profile"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-004
  Scenario: auth other earnings and existing owner work api deny partner credentials
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-005
  Scenario: auth disabled environment blocks redemption without consuming invite
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

