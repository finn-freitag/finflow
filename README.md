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
6. **JSON Backup & Restore**:
   - **Backup & Restore** (sidebar, or the database icon in the mobile header) downloads your whole workspace — accounts, folders, transactions and recurring rules — as a JSON file.
   - Restoring a backup replaces all of your current data in one database transaction; an invalid file changes nothing. Backups can be restored into any account or FinFlow instance.
   - Backups are per user and do not include other users or the admin/auth settings.

---

## Quick Start with Docker Compose

A prebuilt image (`linux/amd64` and `linux/arm64`) is published to the GitHub Container Registry as
`ghcr.io/finn-freitag/finflow`. You only need two files, with no need to clone the repository:

```bash
mkdir finflow && cd finflow
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/finn-freitag/finflow/master/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/finn-freitag/finflow/master/.env.example
```

Edit `.env` (at least change `POSTGRES_PASSWORD` and set `TZ`), then start the stack (app + PostgreSQL 16):

```bash
docker compose up -d
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser:
- On first visit, the **First-Launch Admin Setup Wizard** will appear (unless `ADMIN_EMAIL` and `ADMIN_PASSWORD` were already set in `.env`).
- Database tables and indexes are created automatically on startup.

### Updating

```bash
docker compose pull
docker compose up -d
```

Your data lives in the `postgres_data` volume and is kept across updates. Making a JSON backup
(**Backup & Restore** in the sidebar) before updating doesn't hurt.

### Image tags

| Tag | Contents |
| :--- | :--- |
| `latest` | Newest build of the `master` branch (default) |
| `1.2.3`, `1.2`, `1` | Releases, built from Git tags like `v1.2.3` |
| `sha-abc1234` | A specific commit |

Set `FINFLOW_VERSION` in `.env` to pin a tag, e.g. `FINFLOW_VERSION=1.2`.

### Building the image yourself

From a clone of this repository:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The image is built by [`.github/workflows/docker.yml`](.github/workflows/docker.yml) on every push to
`master` and on version tags; pull requests only check that the image still builds.

---

## Environment Variables (Optional)

All settings go into the `.env` file next to `docker-compose.yml` (see `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `FINFLOW_VERSION` | `latest` | Image tag to run (see [Image tags](#image-tags)) |
| `APP_PORT` | `3000` | Host port exposed by the Next.js container |
| `APP_URL` | `http://localhost:3000` | Public URL of the app |
| `TZ` | `UTC` | Timezone used to decide when recurring transactions are due (e.g. `Europe/Berlin`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `finflow` / `finflow_secret` / `finflow` | Database credentials; set the password before the first start |
| `JWT_SECRET` | *(auto)* | Secret key used to sign session cookies |
| `ADMIN_EMAIL` | *(empty)* | Optional: auto-seeds initial Admin user on first launch if set with `ADMIN_PASSWORD` |
| `ADMIN_PASSWORD` | *(empty)* | Optional: password for auto-seeded initial Admin user |
| `ALLOW_REGISTRATION` | `false` | Whether visitors can self-register (`true` or `false`, also editable in Admin UI) |
| `AUTH_MODE` | `both` | `'both'`, `'builtin'`, or `'oidc'` (also editable in Admin UI) |
| `OIDC_ISSUER` | *(empty)* | OpenID Connect Issuer URL (e.g. Keycloak, Authentik, Pocket ID, Authelia, Google) |
| `OIDC_CLIENT_ID` | *(empty)* | OIDC Client ID |
| `OIDC_CLIENT_SECRET` | *(empty)* | OIDC Client Secret |
| `OIDC_REDIRECT_URI` | `http://localhost:3000/api/auth/oidc/callback` | OIDC Callback URL |
