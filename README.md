# Aurorar

Mobile-first white-theme account and product interface for Cloudflare Pages, Cloudflare Pages Functions, and D1.

## Current status

- Responsive UI for registration/login, Home, Products, Referrals, and Account.
- D1 schema for users, wallets, products, transactions, referrals, and verified payment events.
- Cloudflare deployment configuration scaffold.
- Payment collection/disbursement is **not enabled** until Marzpay API details, webhook verification, and production testing are completed.
- Do not use browser storage as the source of truth for balances or transactions. All financial records must be verified and updated server-side.

## Deploy

1. Create a Cloudflare D1 database named `aurorar-db`.
2. Copy its database ID into `wrangler.toml`.
3. Apply `schema.sql` to the D1 database using the Cloudflare dashboard or Wrangler.
4. Connect this repository to Cloudflare Pages with the repository root as the build output directory.
5. Configure secrets in Cloudflare Pages settings. Never put payment keys or session secrets in frontend code.
6. Add the Marzpay integration only after obtaining the provider's current API documentation and sandbox credentials.
7. Test authentication, mobile money callbacks, duplicate webhook handling, withdrawal limits, and reconciliation before processing real funds.

## Important financial implementation notes

- UGX amounts are stored as integer shillings, never floating-point values.
- The 15% withdrawal fee and UGX 5,000 minimum must be enforced on the server, not just the interface.
- The welcome bonus must be granted once per eligible account with an auditable transaction.
- Payment webhooks must be signature-verified and idempotent.
- Earnings and referral commissions must only be credited by trusted server-side logic after their eligibility conditions are verified.
- Displayed product income and total return are configured figures, not guaranteed profits. Confirm the legal and commercial basis of each plan before launch.

## Product configuration

The ten requested machine plans are shown in the frontend. The production database should be seeded with the same values and should be the source of truth for purchasable plans.
