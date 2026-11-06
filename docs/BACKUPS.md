# Database snapshots

Every day at 08:30 UTC, the **Database snapshot** GitHub Action
(`.github/workflows/db-snapshot.yml`) asks Neon to make a copy of the live
database, a branch named `backup-YYYY-MM-DD`, and deletes snapshots older
than 7 days. The data **never leaves Neon**: the job only calls Neon's API and
never reads the database itself. Snapshots have no compute attached, so they
use no compute time.

You can also make one any time: GitHub → Actions → Database snapshot → Run
workflow. Do this before anything risky, like a big change to the database.

## Turn it on (once)

In GitHub → **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Where to get it |
| --- | --- |
| `NEON_API_KEY` | Neon → your profile → **Account settings → API keys → Create new API key**. Copy it straight into GitHub; don't paste it anywhere else. |
| `NEON_PROJECT_ID` | Neon → open the VolunTrack project → **Settings → General → Project ID** (looks like `long-word-12345678`). |

Then run the workflow once by hand. The log ends with the list of snapshots.
In Neon → **Branches** you'll see `backup-YYYY-MM-DD`.

## Restore

If something went wrong today and yesterday's data was fine:

1. Turn on the maintenance switch (`MAINTENANCE_MODE=1` on Render) so nothing new is saved halfway.
2. Neon → **Branches** → open your main branch → **Restore** → **From another branch** → pick `backup-YYYY-MM-DD` (the last good day) → confirm. Neon keeps a copy of main as it was before the restore, so this can be undone.
3. To look before restoring: open the snapshot → **Add compute** → copy its connection string and check the data (for example with `psql`). Delete that compute afterwards.
4. Turn the maintenance switch off.


## Limits

Neon's free plan allows a limited number of branches per project. Seven
snapshots plus main fits. Snapshots share storage with main and only grow by
what changed since, so they use little extra space.
