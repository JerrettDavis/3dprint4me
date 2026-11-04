Feature: budget
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-006
  Scenario: budget commit within cap
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-007
  Scenario: budget parallel acceptances do not oversubscribe
    When "Open w['origin'] + '/gigs/' + gig['id']"
    When "Select Action 'accept'"
    When "Activate Save decision"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-008
  Scenario: budget acceptance uses deterministic central monday[2026-10-26T04:59:00Z-2026-10-19]
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-009
  Scenario: budget acceptance uses deterministic central monday[2026-10-26T05:01:00Z-2026-10-26]
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-010
  Scenario: budget acceptance uses deterministic central monday[2026-11-02T05:59:00Z-2026-10-26]
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-011
  Scenario: budget acceptance uses deterministic central monday[2026-11-02T06:01:00Z-2026-11-02]
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-012
  Scenario: budget reduced cap preserves earned obligations
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-013
  Scenario: budget sunset blocks new acceptance preserves review and payment
    When "Open w['origin'] + '/gigs/' + extra['id']"
    When "Select Action 'accept'"
    When "Activate Save decision"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

