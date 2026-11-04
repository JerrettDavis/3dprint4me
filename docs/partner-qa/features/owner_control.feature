Feature: owner control
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-053
  Scenario: only owner can publish forty dollar campaign and partner sees frozen offer
    When "Open w['fixture']['ownerOrigin'] + '/partners#campaigns'"
    When "Select Program w['programId']"
    When "Enter Offer title 'Synthetic permitted flyer campaign'"
    When "Enter Offered fee (USD) '40.00'"
    When "Enter Permitted area 'Tulsa permitted business areas'"
    When "Enter Completion deadline '2026-12-01'"
    When "Enter Objective tasks (one per line) 'Respect no-soliciting signs\\nAsk permission before leaving owner-provided flyers'"
    When "Enter Supplied materials (one per line, optional) 'Owner-provided flyers'"
    When "Activate Create campaign draft"
    When "Activate Publish campaign"
    When "Open w['origin'] + '/gigs/' + gig['id']"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-054
  Scenario: owner suspension ends routes but preserves payable for lawful settlement
    When "Open w['origin'] + '/earnings'"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-055
  Scenario: program pause denies unaccepted work without erasing prior debt
    When "Open w['fixture']['ownerOrigin'] + '/partners#programs'"
    When "Activate Save program controls"
    When "Open w['origin'] + '/gigs/' + new['id']"
    When "Activate Save decision"
    When "Open w['origin'] + '/earnings'"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-056
  Scenario: existing private work inbox updates while storefront and status routes stay separate
    When "Open w['fixture']['ownerOrigin']"
    When "Activate row"
    When "Activate Acknowledge"
    When "Select Priority 'high'"
    When "Enter owner.locator('#private-note') 'Synthetic private owner compatibility note.'"
    When "Activate Add private note"
    When "Reload the current page and revalidate its session"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-057
  Scenario: shell port reservations are distinct and exclude other binds until released
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-058
  Scenario: workspace harness allocates distinct ports even when legacy probe reuses one
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

