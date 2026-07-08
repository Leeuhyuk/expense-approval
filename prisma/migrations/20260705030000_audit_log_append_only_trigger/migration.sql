CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();
