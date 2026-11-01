# FinFlow — Hierarchical Category Tree & Private/Business Expense Tracker

A full-stack **Next.js + PostgreSQL** finance tracking application designed for both desktop and mobile devices.

## Key Features

1. **Hierarchical Category Tree with Recursive Folder Sums**:
   - Create folders and unlimited nested subfolders (e.g. `Root` → `Housing & Utilities` → `Utilities` → `Internet & Mobile`).
   - Every folder can contain both subfolders **and** direct expenses or income.
   - **Live Rollup Sums**: Both `Root` and every folder display their recursive current sum (net total, total expenses, and total income of that folder + all its descendant subfolders).
2. **Interactive Spending & Income Charts**:
   - **Per-Folder Breakdown (Donut + Progress Bars)**: Shows how much you spent (or earned) per folder in the selected **Month**, **Year**, or **All Time**. Click any folder slice or bar to drill down into its subfolders!
   - **Yearly Monthly Overview (12-Month Bar Chart)**: Compare monthly **Income vs. Expenses** or **Private vs. Business Expenses** across all 12 months of the selected year for either `Root` or the selected folder.
3. **Private & Business Accounts + Split Expenses**:
   - Create multiple accounts (`Checking`, `Savings`, `Credit Card`, `Cash`, `Investment`) and mark each account as **Private** or **Business**.
   - Every transaction is linked to an account and defaults to that account's scope (`100% Private` or `100% Business`).
   - **Split Transactions**: Any transaction can be split by percentage or exact amount between **Private** and **Business** (e.g., an €80 fiber internet bill paid from a Private checking account that is `50% Business / 50% Private`).
   - Use the top **Scope Switcher (`All`, `Private`, `Business`)** to dynamically recalculate all folder sums, charts, and transaction lists for only the Private share, only the Business share, or combined.
4. **Recurring Transactions**:
   - Schedule recurring subscriptions, rent, or salary (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`) with full Private/Business split support.
5. **First-Launch Admin Setup, Multi-User Isolation & OIDC / Built-in Auth**:
   - On first launch, either use the interactive **Web Onboarding Wizard** to create the Admin user, or pre-seed the Admin user via `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables.
   - Admin can create new users, toggle **Allow Public Self-Registration**, and choose between **Built-in Email/Password Auth**, **OpenID Connect (OIDC)**, or **Both**.
   - Each user has an isolated workspace (own accounts, category tree, and transactions).

---

## Quick Start with Docker Compose

Run the entire stack (Next.js app + PostgreSQL 16 database) with a single command:

```bash
docker compose up -d
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser:
- On first visit, the **First-Launch Admin Setup Wizard** will appear (unless `ADMIN_EMAIL` and `ADMIN_PASSWORD` were already set in `.env` or `docker-compose.yml`).
- Database tables and indexes are created automatically on startup.

---

## Environment Variables (Optional)

You can customize `docker-compose.yml` or create a `.env` file (see `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `APP_PORT` | `3000` | Host port exposed by the Next.js container |
| `JWT_SECRET` | *(auto)* | Secret key used to sign session cookies |
| `ADMIN_EMAIL` | *(empty)* | Optional: auto-seeds initial Admin user on first launch if set with `ADMIN_PASSWORD` |
| `ADMIN_PASSWORD` | *(empty)* | Optional: password for auto-seeded initial Admin user |
| `ALLOW_REGISTRATION` | `false` | Whether visitors can self-register (`true` or `false`, also editable in Admin UI) |
| `AUTH_MODE` | `both` | `'both'`, `'builtin'`, or `'oidc'` (also editable in Admin UI) |
| `OIDC_ISSUER` | *(empty)* | OpenID Connect Issuer URL (e.g. Keycloak, Authentik, Pocket ID, Authelia, Google) |
| `OIDC_CLIENT_ID` | *(empty)* | OIDC Client ID |
| `OIDC_CLIENT_SECRET` | *(empty)* | OIDC Client Secret |
| `OIDC_REDIRECT_URI` | `http://localhost:3000/api/auth/oidc/callback` | OIDC Callback URL |
