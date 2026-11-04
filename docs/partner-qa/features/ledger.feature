Feature: ledger
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-026
  Scenario: separate personal gift is absent from partner statement and contractor exports
    When "Open w['origin'] + '/earnings'"
    When "Activate Download statement for 2026-11-02"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-027
  Scenario: unconfigured invoice ninja preserves durable payable and manual csv without customer invoice
    When "Open w['origin'] + '/earnings'"
    When "Reload the current page and revalidate its session"
    When "Activate Download verified CSV"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

