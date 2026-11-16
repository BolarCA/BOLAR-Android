/**
 * ReBAC relationship vocabulary (blueprint p15, Day 13).
 * subjectType:subjectId --relation--> objectType:objectId
 */
export const RELATIONS = [
  'owner_of',        // user -> property | portfolio
  'manages',         // user -> property | subaccount
  'tenant_of',       // user|tenant_profile -> lease | unit
  'occupant_of',     // user -> lease
  'represents',      // user(lawyer) -> case | tenant_org
  'assigned_to',     // user(vendor) -> work_order
  'vendor_for',      // vendor_profile -> property
  'agency_for',      // user(government) -> agency_request
  'member_of',       // user -> business_account | subaccount
  'bookkeeper_for',  // user -> subaccount | property
] as const;
export type Relation = (typeof RELATIONS)[number];

export const SUBJECT_TYPES = ['user', 'tenant_profile', 'vendor_profile'] as const;
export const OBJECT_TYPES = [
  'tenant_org', 'business_account', 'subaccount', 'portfolio', 'property', 'unit', 'lease',
  'work_order', 'case', 'agency_request', 'document',
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export function isRelation(v: string): v is Relation {
  return (RELATIONS as readonly string[]).includes(v);
}
