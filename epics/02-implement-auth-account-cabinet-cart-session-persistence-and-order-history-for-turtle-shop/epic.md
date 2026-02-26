# Epic: Implement auth, account cabinet, cart session persistence, and order history for turtle-shop

## Goal
Deliver a production-ready customer account experience for turtle-shop that enables users to authenticate securely, keep cart contents across sessions, manage their account in a personal cabinet, and view prior orders. The outcome should improve conversion continuity and post-purchase transparency without regressing guest checkout behavior.

## Scope
- Implement user authentication flows (sign up, sign in, sign out, guarded routes, and session handling).
- Build account cabinet pages and APIs for profile viewing/editing and account-level navigation.
- Add cart session persistence so cart state survives reloads, browser restarts, and authenticated session transitions.
- Implement order history in account cabinet, including order list and order details with status and totals.
- Add or update tests and validation coverage for the new auth, cart persistence, and order history flows.

## Out of Scope
- Payment gateway changes, checkout redesign, or new shipping logic.
- Admin-side order management features.
- Recommendation, loyalty, or marketing features unrelated to account and history.
- Large visual redesign outside the account/auth/cart-history surfaces.

## Success Criteria
- Users can register, log in, log out, and access protected account routes with correct authorization behavior.
- Cart contents persist between sessions and remain consistent after authentication state changes.
- Authenticated users can open account cabinet, update profile data, and navigate account sections without errors.
- Users can view their historical orders with key metadata and open individual order details.
- Automated tests cover critical happy paths and key edge cases for auth, persistence, and order history.
