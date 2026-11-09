-- ADR-171 (revised): a legal entity's claim approvers are worked out from
-- each approver's own legal entity, not chosen by hand, so the hand-set
-- list goes.
DROP TABLE IF EXISTS "legal_entity_claim_approvers";
