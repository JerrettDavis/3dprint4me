-- Push is optional. No enrolled delivery is a skipped notification, not a
-- provider failure or proof of delivery. Keep existing failures for review.
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_state_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_state_check
  CHECK (state IN ('pending','processing','delivered','failed','skipped'));
