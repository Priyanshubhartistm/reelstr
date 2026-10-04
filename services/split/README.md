# @reelstr/split

The split service. Pays out each episode's revenue according to its signed split, by nutzap or Lightning address, carries dust balances, and publishes signed payout receipts. It holds funds between unlock and payout, so it is off by default and needs `acknowledgeCustody`.

**Main exports:** `runPayouts`.

**Test:** `bun test services/split`.
