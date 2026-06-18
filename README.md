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

The date dropdown is an explicit list of dates at the top of `app.py` — the
**same list for everyone** who gets the link. Edit it to the dates you need
(ISO `YYYY-MM-DD`), up to 20 entries:

```python
MAX_DATES = 20       # max dates offered in the dropdown (hard cap of 20)

ABSENCE_DATES = [
    "2026-06-18",
    "2026-06-19",
    "2026-06-20",
]
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
| `PORT`           | no       | `8000`        | Port to bind (set automatically by Render).  |

> Always set a real `ADMIN_PASSWORD` in production — the default is insecure.

## Deploy to Render

This repo includes a `render.yaml` blueprint, so you can deploy in one of two
ways.

### Option A — Blueprint (recommended)

1. Push this project to a GitHub repo.
2. In [Render](https://render.com), click **New → Blueprint** and pick the repo.
   Render reads `render.yaml` and creates the web service automatically.
3. When prompted (or in the service's **Environment** tab afterwards), set:
   - `ADMIN_PASSWORD` = your chosen password
4. Deploy. Render gives you a public URL — share `https://<your-app>.onrender.com/`
   as the form link, and use `/admin` for the dashboard.

### Option B — Manual web service

1. In Render, click **New → Web Service** and connect the repo.
2. Set:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Environment variable:** `ADMIN_PASSWORD` = your chosen password
3. Deploy.

`$PORT` is provided by Render automatically — the app reads it, so no code
changes are needed.

### Note on data persistence

SQLite stores data in a file on the container's filesystem, which is **ephemeral**
on Render's free tier — it resets on every deploy and on restarts. For durable
storage, attach a [Render Disk](https://render.com/docs/disks) and point the app
at it:

1. Add a disk to the service (e.g. name `data`, mount path `/data`, 1 GB).
2. Set `DB_PATH=/data/absences.db`.

The `render.yaml` has both of these commented out — uncomment them to enable.

## Validation rules

- Name and Employee Code are required.
- At least 1 date entry; at most 20.
- No duplicate dates within a single submission.
- If the reason is "Other (specify)", the specify text is required.
- On error the form re-renders with the entered values kept and clear messages.
