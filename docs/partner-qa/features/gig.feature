Feature: gig
  Synthetic acceptance evidence; no actual professional approval or payment.

  Background:
    Given an isolated PostgreSQL fixture and authenticated scoped actors
    And only synthetic participants, business records and simulation evidence

  @QA-022
  Scenario: gig accept ten unique visits submit and owner review without attendance
    When "Open w['origin'] + '/gigs/' + gig['id']"
    When "Open w['origin'] + '/visits/new?gig=' + gig['id']"
    When "Enter Business name 'Synthetic permitted business ' + str(number)"
    When "Enter Visit time instant"
    When "Select Outcome 'accepted_material'"
    When "Select Permission to leave materials 'permission_received'"
    When "Enter Samples left '1'"
    When "Activate Submit visit"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-023
  Scenario: gig decline has no obligation or penalty and future offer can be accepted
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-024
  Scenario: gig unsafe report reaches owner without location tracking or retaliation
    When the documented infrastructure or API operation runs
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

  @QA-025
  Scenario: gig offline visit and work submission retry after committed lost responses
    When "Open w['origin'] + '/visits/new?gig=' + gig['id']"
    When "Enter Business name 'Synthetic one offline permitted business'"
    When "Enter Visit time instant"
    When "Confirm page.locator('#device-permission')"
    When "Activate Save business draft on this device"
    When "Activate Device drafts"
    When "Activate Send pending business drafts"
    When "Reload the current page and revalidate its session"
    When "Open w['origin'] + '/gigs/' + gig['id']"
    When "Enter Reason or submission details 'Synthetic offline business visit submitted for owner review.'"
    When "Activate Submit work for review"
    Then the linked native assertions confirm the expected persisted and access-control effects
    And no actual clearance, work or funds are represented by the test

