# Quick start: corporate tenant admin portal (/corporate-admin)

Demo account corp@demo.bolar.test. For coordinators at a company that houses employees in managed units.

## 1. Overview (/corporate-admin)

Screenshot (described): heading "Corporate housing overview"; KPI cards Corporate accounts, Occupants, Active leases,
Monthly spend; sections "Occupants", "Leases" and "Documents", each with an explanatory empty state until records are
linked to your corporate account.

- Figures come from leases and documents linked to the corporate account by the property manager; nothing is entered
  here.

## 2. Occupants (/corporate-admin/occupants)

Screenshot (described): a list of occupants with name, unit, lease dates and status, or the empty state.

- Occupants are added when the property manager records them on a lease and links their login with the
  `occupant_of` relationship. Ask the manager to add or remove people.

## 3. Sidebar item not yet available

"Spend" appears in the sidebar but opens a not-found page in this release; use the Monthly spend card on the
overview.

## 4. Access

You reach only this portal. Resident details, finance and documents outside your corporate account show the denied
state.

Support: your property manager (tier 1), then [../runbooks/support-escalation.md](../runbooks/support-escalation.md).
