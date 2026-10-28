-- Retain one customer-intake session while permitting additional operator revisions.
ALTER TABLE print_estimate_sessions DROP CONSTRAINT IF EXISTS print_estimate_sessions_request_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS print_customer_request_session ON print_estimate_sessions(request_id)
 WHERE NOT (assumptions ? '_operatorWorkId');
CREATE UNIQUE INDEX IF NOT EXISTS print_operator_revision ON print_estimates(request_id,(geometry_metrics->>'operatorRevision'))
 WHERE purpose='operator' AND geometry_metrics ? 'operatorRevision';
