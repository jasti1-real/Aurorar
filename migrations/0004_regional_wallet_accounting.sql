-- Match regional wallet accounting fields to the UGX wallet without moving or converting funds.
ALTER TABLE currency_wallets ADD COLUMN referral_earnings INTEGER NOT NULL DEFAULT 0 CHECK (referral_earnings >= 0);
