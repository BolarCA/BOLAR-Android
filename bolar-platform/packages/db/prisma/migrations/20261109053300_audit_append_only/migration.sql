-- Audit log is append-only (blueprint p22 "append-only audit store", Day 46).
-- Any UPDATE or DELETE on AuditLog is rejected at the database level.
CREATE OR REPLACE FUNCTION bolar_reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON "AuditLog";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION bolar_reject_audit_mutation();

-- Posted journal entries are immutable; only reversals are allowed (Day 37).
CREATE OR REPLACE FUNCTION bolar_reject_posted_journal_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."postedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Posted JournalEntry is immutable; create a reversal instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entry_immutable ON "JournalEntry";
CREATE TRIGGER journal_entry_immutable
  BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION bolar_reject_posted_journal_mutation();

CREATE OR REPLACE FUNCTION bolar_reject_posted_ledger_mutation() RETURNS trigger AS $$
DECLARE posted TIMESTAMP;
BEGIN
  SELECT "postedAt" INTO posted FROM "JournalEntry" WHERE id = OLD."journalEntryId";
  IF posted IS NOT NULL THEN
    RAISE EXCEPTION 'LedgerEntry of a posted JournalEntry is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entry_immutable ON "LedgerEntry";
CREATE TRIGGER ledger_entry_immutable
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION bolar_reject_posted_ledger_mutation();
