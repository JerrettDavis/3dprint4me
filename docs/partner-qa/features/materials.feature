Feature: materials
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-031
  Scenario: owner records materials with durable retry and partner private history
    When "Open w['fixture']['ownerOrigin'] + '/partners#gig/' + gig['id']"
    When "Enter Material label 1 'Sample signs <script>not executable</script>'"
    When "Enter Material count 1 '5'"
    When "Activate Record materials"
    When "Select Material event 'returned'"
    When "Enter Material count 1 '3'"
    When "Open w['origin'] + '/gigs/' + gig['id']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-032
  Scenario: large material history is explicitly partial and keeps newest records
    When "Open w['origin'] + '/gigs/' + gig['id']"
    When "Open w['fixture']['ownerOrigin'] + '/partners#gig/' + gig['id']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

