# Quick start: resident portal (/tenant)

Demo account tenant@demo.bolar.test. Designed for the phone first: below 1024 px a bottom bar with Home, Pay,
Maintenance, Documents and Profile replaces the sidebar.

## 1. Home

Screenshot (described): greeting "Hi, <first name>"; a property card with the building name and unit; a balance card
with the amount due and a Pay button; a maintenance card with the number of open requests; a documents list where
confidential items show a lock and a "Request access" link; notices and messages sections; the bottom bar with the
current tab highlighted.

## 2. Pay rent

Screenshot (described): heading "Pay rent"; the open invoices with "Pay invoice INV-..." buttons; a payment dialog
with a card number field (pre-filled with the test card on staging) and a "Pay $..." button; after success, "Payment
received" and the Payment history table shows the invoice as succeeded.

- On staging payments run in mock mode; no card is charged. In production your card is handled by the payment
  provider, never stored by BOLAR.

## 3. Maintenance

Screenshot (described): heading "Maintenance" with a "New request" form (Title, Category, Priority with guidance text,
Description, Entry permission, optional photo) and a "My requests" table with status.

1. Pick the priority honestly: emergency means a 24-hour target and is for leaks, no heat, electrical hazards. For
   danger to life call 911 first, as the form says.
2. After "Submit request" keep the request number (`WO-XXXXXX`). The row shows status changes as the manager triages,
   assigns and schedules; the vendor's visit time appears when scheduled.
3. If photos cannot be attached in this build the request is still submitted; a manager may ask for photos later.

## 4. Documents

Screenshot (described): heading "My documents" with your lease and other shared files, their classification, and a
"Messages" inbox below with in-app notifications such as invoice issued or request received.

## 5. Profile

Screenshot (described): sections Account, Sign-in security (authenticator set up with a key and a 6-digit code
field), Contact methods, Emergency contacts, Household, Privacy.

- Turn on the authenticator: "Set up", add the key to your authenticator app, enter the code. Keep the app; you will
  enter a code for sensitive actions.
- The Privacy section explains how to request a copy or deletion of your data.

## Need help

Your property manager is the first contact. For sign-in problems use the support path in
[../runbooks/support-escalation.md](../runbooks/support-escalation.md).
