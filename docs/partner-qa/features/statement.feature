Feature: statement
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-059
  Scenario: owner schedules weekly statements and partners download only their immutable balances
    When "Open w['fixture']['ownerOrigin'] + '/partners#statements'"
    When "Confirm Schedule weekly statements"
    When "Activate Save statement schedule"
    When "Open w['origin'] + '/earnings'"
    When "Activate Download statement for 2026-11-02"
    When "Activate Finance"
    When "Activate Weekly statements"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

