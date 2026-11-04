Feature: legal acceptance
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-028
  Scenario: review package excludes unrelated private records and denies anonymous download
    When "Open w['fixture']['ownerOrigin'] + '/partners#legal/package/' + package['id']"
    When "Activate Download signed ZIP (unencrypted)"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-029
  Scenario: unreviewed issuance returns exact missing classification and language gates
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-030
  Scenario: version b requires independent reviews new issue and new ack without changing a
    When "Open w['fixture']['ownerOrigin'] + '/partners#legal/version/' + b['versionId']"
    When "Select Review context program w['programId']"
    When "Activate Publish reviewed revision"
    When "Open w['origin'] + '/agreements'"
    When "Confirm I have read this exact issued version."
    When "Activate Record read acknowledgment"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

