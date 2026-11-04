Feature: forecast
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-020
  Scenario: forecasts replace fee and bonus reserves preserve week and show unfunded debt
    When "Open w['origin']"
    When "Enter Account code w['accounts'][0]['id']"
    When "Enter Passphrase 'Synthetic budget partner private passphrase'"
    When "Activate Sign in"
    When "Open w['fixture']['ownerOrigin'] + '/partners#forecasts/' + w['programId']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-021
  Scenario: forecast earned bonus is counted once and incomplete evidence fails safely
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

