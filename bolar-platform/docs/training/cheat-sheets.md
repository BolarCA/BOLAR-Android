# One-page cheat sheets

One section per portal, each designed to print on a single page. Sign in at `/login` with your email and password
(demo accounts use `Bolar!Demo2026`); you land on your first portal. Switch portals from the switcher at the top of
the sidebar when your role has more than one. "Sign out" is at the bottom of the sidebar. Support: see
[../runbooks/support-escalation.md](../runbooks/support-escalation.md).

## Master admin (/admin)

| I want to | Go to | Do |
| --- | --- | --- |
| See platform health | Overview | Read API health, db, organizations, queue driver |
| Find an organization | Organizations | Click its name for subaccounts and recent audit |
| Help a customer in their org | Organization detail | "Start support session" (reason, 15-480 min), "Act as <org>", finish with "Stop acting as org" and end the session under Support sessions |
| Turn a feature on | Feature flags | "New flag" (key, JSON rules), then "Enable <key>" |
| Investigate who did what | Audit | Filter by action prefix and outcome; cross-org query is itself audited |

Rules: every cross-org action is audited twice (platform and customer org); support sessions expire on their own.

## Subaccount admin (/subaccount)

| I want to | Go to | Do |
| --- | --- | --- |
| Add staff | Staff & roles | "Invite user", email and one role; "Revoke invitation" if sent in error |
| Remove access now | Staff & roles | "Suspend" (sessions end immediately); "Reactivate" later |
| Approve a colleague's request to see SSN or DOB | Access requests | "Approve 8h" or "Deny" (you cannot approve your own) |
| Follow a privacy request | Privacy requests | Countdown chip shows days left; open for discovery and decisions |
| Keep or dispose records | Retention | Policies, assignments, "Run sweep" proposes; "Approve" is the only way to dispose |
| Review activity | Audit | Action prefix (for example `invitation.`), outcome `deny` for blocked attempts |

## Property manager (/manager)

| I want to | Go to | Do |
| --- | --- | --- |
| See what needs me today | Operations | Queue sorted by overdue first; filter by property, type, due date, priority; "Open ..." deep links |
| Add a building or unit | Properties | "Add property", then "Add unit"; unit status changes need a reason |
| Create a resident | Tenants | "New tenant profile"; confidential fields are redacted until "Request access" is approved |
| Draft a lease | Leases | "New lease", "Submit for review"; the landlord approves; then "Send for e-signature" |
| Screen an applicant | Applications | "Record applicant consent" before "Order screening"; decisions are yours; a denial starts the adverse-action clock |
| Send a notice | Notices | "Draft notice"; guard hits block sending until compliance resolves; approval by another person |
| Run repairs | Maintenance | Card: "Triage", "Assign" (eligible vendors only), "Schedule"; "Run SLA scan" flags overdue |
| Manage contractors | Vendors | "Add vendor", upload insurance and MSA, approve on the vendor page; "Suspend" stops new assignments |
| Share files | Documents | "Upload document", "Download" gives a short-lived signed link |
| Change wording | Templates | "New template", "Submit for approval" (counsel approves high-risk), "Render" to preview |

## Landlord (/owner)

| I want to | Go to | Do |
| --- | --- | --- |
| Check my portfolio | Dashboard | KPIs, occupancy bars, collected and overdue, approvals inbox |
| Approve a lease | Approvals | "Approve lease" on the row |
| Look at a property | Properties | Read-only detail; you only see properties you own |
| Read documents | Documents | Classification shown; confidential items may require an access request |

## Resident (/tenant)

| I want to | Tap | Do |
| --- | --- | --- |
| Pay rent | Pay | "Pay invoice INV-...", confirm; receipt in Payment history |
| Report a problem | Maintenance | Title, category, priority, description, entry permission, "Submit request"; keep the WO number. Danger to life: call 911 first |
| Read my lease | Documents | Confidential items show a lock; "Request access" if needed |
| Secure my account | Profile | Sign-in security: "Set up" authenticator, enter the 6-digit code |
| Update contacts | Profile | Contact methods, emergency contacts, household |

## Bookkeeper (/finance)

| I want to | Go to | Do |
| --- | --- | --- |
| Check the books balance | Dashboard | Double-entry proof must read "Ledger balances"; receivables aging by tenant |
| Bill rent | Invoices | "Generate invoices" for a period (YYYY-MM); re-running never duplicates; "Void invoice" while unpaid |
| See money in | Payments | Succeeded and failed payments; "Refund (approval-gated)" needs a second approver |
| Review entries | Ledger | Trial balance "Balanced"; journal entries; "Request a manual adjustment" needs approval |

## Lawyer (/legal)

| I want to | Go to | Do |
| --- | --- | --- |
| Open a matter | Cases | "New case" (title, kind, lease id); case page is privileged |
| Preserve records | Case page | "Place legal hold" (reason, counsel note); release needs different counsel |
| Answer an agency | Cases list, agency requests | Minimization notes, "Legal review", decision note, "Approve" or deny |
| Produce evidence | Case page | "Request export"; a different approver releases; manifest with sha256 |
| Decide privacy requests | Privacy requests | "Run discovery", "Review exceptions", decide, "Fulfil request" |
| Approve sensitive access | Access approvals | "Approve 8h" or "Deny" |

## Vendor (/vendor)

| I want to | Go to | Do |
| --- | --- | --- |
| See my jobs | My jobs | Only jobs assigned to you; overdue and scheduled today at the top |
| Work a job | Job page | "Start work", "Mark blocked" (reason), "Submit for review"; add notes and cost |
| Something is not mine | Job page | Denied means it is not assigned to you; call the manager |

## Compliance officer (/compliance)

| I want to | Go to | Do |
| --- | --- | --- |
| Clear rule hits | Queue | "Evidence for ..." shows conditions and the statute link; "Accept" with a note |
| Export evidence | Queue | "Export manifest" (JSON with hashes) |
| Maintain rules | Rules | "New version", "Preview against sample facts", "Activate" after counsel sign-off, "Retire" |
| Approve notices | Notices | "Approve" or "Reject" with reason; never your own draft |

## Government (/gov)

| I want to | Go to | Do |
| --- | --- | --- |
| Request records | Requests | Agency name, kind, legal basis, scope; "Submit request"; status moves after legal review |
| Collect a release | Exports | "Download manifest" when an export is released; links expire quickly |

## Corporate tenant admin (/corporate-admin) and occupant (/occupant)

| I want to | Go to | Do |
| --- | --- | --- |
| See corporate housing | Overview | Accounts, occupants, active leases, spend; sections fill as data is linked |
| List occupants | Occupants | Occupant list for your corporate account |
| Occupant: see my housing | Home | My housing, my requests |
| Occupant: report a problem | Requests | Available once your lease is linked by the property manager |
| Occupant: read documents | Documents | Shared documents |
