# Employee Absence Reasons

A tiny FastAPI web app for collecting employee absence reasons via **one shared
public link**, with a **password-protected admin page** to view and export all
submissions.

- **Public form** (`/`) — anyone with the link can fill it in and submit. Name,
  Employee Code, and a repeating list of date entries (date + reason +
  optional "specify" text). The same link is reusable by everyone.
- **Admin page** (`/admin`) — password-protected. Shows a flat table of every
  date entry across all people and lets you download the data as **CSV** or
  **Excel (.xlsx)**.

## Stack

- Python + FastAPI
- SQLite (single file, `absences.db`)
- Jinja2 templates + vanilla JS (no build step)
- openpyxl for Excel export

## Configuration

The date dropdown and limits are constants at the top of `app.py`:

```python
YEAR = 2025          # change the year here
MONTH = 5            # May
DAYS_IN_MONTH = 31
MAX_ROWS = 20        # max date entries per submission
```

## Run locally

```bash
# 1. Create a virtualenv and install deps
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 2. Set the admin password (any username works at the login prompt)
export ADMIN_PASSWORD="your-secret-password"   # Windows PowerShell: $env:ADMIN_PASSWORD="..."

# 3. Run
uvicorn app:app --reload
```

Then open:

- Public form: http://localhost:8000/
- Admin page:  http://localhost:8000/admin  (username: anything, password: `ADMIN_PASSWORD`)

The SQLite database `absences.db` is created automatically on first run.

## Environment variables

Copy `.env.example` to `.env` for reference (the app reads from the actual
process environment, not the file):

| Variable         | Required | Default       | Description                                  |
|------------------|----------|---------------|----------------------------------------------|
| `ADMIN_PASSWORD` | yes      | `changeme`    | Password for the `/admin` page.              |
| `DB_PATH`        | no       | `absences.db` | Path to the SQLite file.                     |
| `PORT`           | no       | `8000`        | Port to bind (set automatically by Railway). |

> Always set a real `ADMIN_PASSWORD` in production — the default is insecure.

## Deploy to Railway

1. Push this project to a GitHub repo.
2. In [Railway](https://railway.app), click **New Project → Deploy from GitHub
   repo** and pick the repo.
3. Railway auto-detects Python and installs `requirements.txt`. The included
   **`Procfile`** defines the start command:
   ```
   web: uvicorn app:app --host 0.0.0.0 --port $PORT
   ```
   `$PORT` is provided by Railway automatically.
4. Go to your service's **Variables** tab and add:
   - `ADMIN_PASSWORD` = your chosen password
5. Deploy. Railway gives you a public URL — share `https://<your-app>.up.railway.app/`
   as the form link, and use `/admin` for the dashboard.

### Note on data persistence

SQLite stores data in a file on the container's filesystem, which is ephemeral
on Railway (it can be reset on redeploys). For durable storage, attach a
[Railway Volume](https://docs.railway.app/reference/volumes) mounted at e.g.
`/data` and set `DB_PATH=/data/absences.db`.

## Validation rules

- Name and Employee Code are required.
- At least 1 date entry; at most 20.
- No duplicate dates within a single submission.
- If the reason is "Other (specify)", the specify text is required.
- On error the form re-renders with the entered values kept and clear messages.
