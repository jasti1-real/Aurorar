# Regional payments and UGX ledger release gate

This checklist is required before enabling Rwanda (RW) and Zambia (ZM) deposits/withdrawals with a single UGX customer ledger.

## Current observed implementation

- The payment API accepts local market amounts and sends the local currency to MarzPay: UGX for Uganda, RWF for Rwanda, and ZMW for Zambia.
- Regional wallet balances are stored separately in `currency_wallets`; regional purchases/earnings use regional tables.
- `/api/me` selects the local-currency wallet for RW/ZM accounts.
- The frontend formats money using the registered country's currency.
- Existing regional transaction rows include legacy `amount_ugx` values that must not be assumed to be UGX. Some rows have no `ledger_amount_ugx`.
- The current withdrawal route records Rwanda/Zambia requests as manual; do not describe these as automatic provider payouts.

## Fixed welcome bonus

- The welcome bonus is **UGX 2,000** for every eligible user, regardless of whether their registered country is Uganda, Rwanda, or Zambia.
- Display the bonus as `UGX 2,000` in the interface for all three countries. Never substitute local-currency equivalents such as RWF or ZMW values in the customer-facing bonus.
- The display amount is not permission to make a bonus withdrawable or to credit it more than once. Preserve the existing eligibility and ledger rules, and ensure the bonus is granted only once according to the verified backend logic.

## Public MarzPay documentation check (2026-10-31)

- The public Collections guide specifies the amount in the market currency and supports UGX, RWF, and ZMW by country.
- The public Send Money guide likewise specifies the amount in the market currency for payouts.
- The public API reference documents collection, send-money, service, balance, and transaction endpoints, but the reviewed public documentation does not establish a merchant FX conversion/UGX settlement API for Rwanda or Zambia.
- Therefore, do not assume MarzPay automatically converts regional funds into UGX for Aurorar. Confirm the merchant account's actual settlement wallets and conversion terms with MarzPay before implementation.

References: https://wallet.wearemarz.com/documentation/collections ; https://wallet.wearemarz.com/documentation/send-money ; https://wallet.wearemarz.com/documentation/api

## Required provider-side evidence

An account administrator must verify in MarzPay (not infer from public documentation):

- Collection services enabled for each country and network.
- Disbursement services enabled for each country and network.
- Live-mode status, allowed callback URL, and any required IP/signature settings.
- The actual settlement/conversion rule, including rate source, fees, rounding, and whether the merchant settles into UGX or separate local-currency balances.
- A successful low-value live collection and payout in each market, reconciled against provider statements.

Never put API keys, secrets, PINs, or full customer phone numbers in this repository or support tickets.

## Required implementation before displaying every amount as UGX

1. Add a persisted, immutable settlement record for every verified regional deposit containing provider-local amount/currency, exact provider-reported settlement amount/currency, rate (or explicit provider conversion result), fees, and a provider reference.
2. Credit the UGX wallet only from that verified settlement record, in the same idempotent database transaction as the payment status transition.
3. Do not derive financial credits from frontend display rates, public spot-rate APIs, or hard-coded multipliers.
4. For withdrawals, quote and persist the UGX debit, provider-local payout amount/currency, tax, fees, and conversion source before submission. Use an idempotency key and reconcile uncertain provider responses before retrying.
5. Keep existing RWF/ZMW balances frozen for reconciliation until each balance is tied to provider-confirmed deposits/earnings/withdrawals. Do not bulk-convert legacy balances without evidence.
6. Update `/api/me` and the UI to show only verified UGX ledger values. If no verified UGX settlement exists, show a clear “awaiting reconciliation” state rather than relabeling a local-currency amount as UGX.
7. Add tests for signed callback validation, duplicate callbacks, amount/currency mismatch, failed collections, payout timeouts, duplicate payout submissions, conversion rounding, and balance invariants.

## Release gate

Do not enable regional UGX credits or claim automatic regional payouts until the provider evidence, migration, tests, and reconciliation report are reviewed. UI label changes alone are not a financial conversion and can misstate customer funds.
