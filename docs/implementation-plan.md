You need to update it in two places:

**1. Railway (production)**

1. Go to [railway.app](https://railway.app) → your project → the service → **Variables** tab
2. Find `VITE_NAIRA_LOCK_ADDRESS`
3. Change the value to `0x440499033437d1578289dd57ee3cb1469829a4cb`
4. Railway will automatically redeploy

**2. Local `.env` (already done)**

I already updated it in your `.env` file during the build. Your local dev server is already pointing at v7.

That's it. Once Railway redeploys, the live app at `https://testonarc-production.up.railway.app` will use the new contract.
