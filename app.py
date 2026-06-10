"""
Employee Absence Reasons — small FastAPI app.

One shared public form at "/" for collecting absence reasons, and a
password-protected admin page at "/admin" to view and export all submissions.
"""

import csv
import io
import os
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime

from fastapi import FastAPI, Form, Request, Response, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, StreamingResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates

# ---------------------------------------------------------------------------
# Config — change these as needed.
# ---------------------------------------------------------------------------
YEAR = 2025          # Year used for the date dropdown (change here to update).
MONTH = 5            # Month (May). Together with YEAR drives the date options.
MONTH_NAME = "May"
DAYS_IN_MONTH = 31   # Number of days to list in the dropdown.
MAX_ROWS = 20        # Maximum date entries per submission.

REASONS = ["Log out", "Missed regularisation", "Other (specify)"]
OTHER_REASON = "Other (specify)"

DB_PATH = os.environ.get("DB_PATH", "absences.db")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")

# Pre-build the list of selectable dates, e.g. ("2025-05-01", "01 May").
DATE_OPTIONS = [
    (f"{YEAR:04d}-{MONTH:02d}-{day:02d}", f"{day:02d} {MONTH_NAME}")
    for day in range(1, DAYS_IN_MONTH + 1)
]
VALID_DATE_VALUES = {value for value, _ in DATE_OPTIONS}

app = FastAPI(title="Employee Absence Reasons")
templates = Jinja2Templates(directory="templates")
security = HTTPBasic()


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with closing(get_db()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS submissions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL,
                employee_code TEXT NOT NULL,
                submitted_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entries (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL,
                entry_date    TEXT NOT NULL,
                reason        TEXT NOT NULL,
                specify_text  TEXT,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
            );
            """
        )
        conn.commit()


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def require_admin(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    correct = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)
    if not correct:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ---------------------------------------------------------------------------
# Public form
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def form_page(request: Request):
    return templates.TemplateResponse(
        "form.html",
        {
            "request": request,
            "date_options": DATE_OPTIONS,
            "reasons": REASONS,
            "other_reason": OTHER_REASON,
            "max_rows": MAX_ROWS,
            "errors": [],
            "name": "",
            "employee_code": "",
            "rows": [{"entry_date": "", "reason": "", "specify_text": ""}],
        },
    )


def _parse_rows(form) -> list[dict]:
    """Pull repeating row fields out of the submitted form into a list."""
    dates = form.getlist("entry_date")
    reasons = form.getlist("reason")
    specifies = form.getlist("specify_text")
    rows = []
    for i in range(len(dates)):
        rows.append(
            {
                "entry_date": dates[i].strip() if i < len(dates) else "",
                "reason": reasons[i].strip() if i < len(reasons) else "",
                "specify_text": specifies[i].strip() if i < len(specifies) else "",
            }
        )
    return rows


@app.post("/", response_class=HTMLResponse)
async def submit_form(request: Request):
    form = await request.form()
    name = (form.get("name") or "").strip()
    employee_code = (form.get("employee_code") or "").strip()
    rows = _parse_rows(form)

    errors: list[str] = []

    if not name:
        errors.append("Name is required.")
    if not employee_code:
        errors.append("Employee Code is required.")

    # Drop fully-empty rows (no date and no reason picked).
    filled_rows = [r for r in rows if r["entry_date"] or r["reason"]]
    if not filled_rows:
        errors.append("Please add at least one date entry.")

    if len(filled_rows) > MAX_ROWS:
        errors.append(f"You can add at most {MAX_ROWS} date entries.")

    seen_dates: set[str] = set()
    for idx, row in enumerate(filled_rows, start=1):
        if not row["entry_date"]:
            errors.append(f"Row {idx}: please select a date.")
        elif row["entry_date"] not in VALID_DATE_VALUES:
            errors.append(f"Row {idx}: invalid date selected.")
        elif row["entry_date"] in seen_dates:
            errors.append(f"Row {idx}: duplicate date — each date can only be used once.")
        else:
            seen_dates.add(row["entry_date"])

        if not row["reason"]:
            errors.append(f"Row {idx}: please select a reason.")
        elif row["reason"] not in REASONS:
            errors.append(f"Row {idx}: invalid reason selected.")
        elif row["reason"] == OTHER_REASON and not row["specify_text"]:
            errors.append(f"Row {idx}: please specify a reason for 'Other'.")

    if errors:
        return templates.TemplateResponse(
            "form.html",
            {
                "request": request,
                "date_options": DATE_OPTIONS,
                "reasons": REASONS,
                "other_reason": OTHER_REASON,
                "max_rows": MAX_ROWS,
                "errors": errors,
                "name": name,
                "employee_code": employee_code,
                "rows": filled_rows or [{"entry_date": "", "reason": "", "specify_text": ""}],
            },
            status_code=400,
        )

    with closing(get_db()) as conn:
        cur = conn.execute(
            "INSERT INTO submissions (name, employee_code, submitted_at) VALUES (?, ?, ?)",
            (name, employee_code, datetime.utcnow().isoformat(timespec="seconds")),
        )
        submission_id = cur.lastrowid
        for row in filled_rows:
            specify = row["specify_text"] if row["reason"] == OTHER_REASON else None
            conn.execute(
                "INSERT INTO entries (submission_id, entry_date, reason, specify_text) "
                "VALUES (?, ?, ?, ?)",
                (submission_id, row["entry_date"], row["reason"], specify),
            )
        conn.commit()

    return templates.TemplateResponse("thanks.html", {"request": request})


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
def _date_label(value: str) -> str:
    """Turn a stored 'YYYY-MM-DD' value into a friendly label like '01 May'."""
    try:
        d = datetime.strptime(value, "%Y-%m-%d")
        return d.strftime("%d %b")
    except ValueError:
        return value


def fetch_all_entries() -> list[dict]:
    with closing(get_db()) as conn:
        rows = conn.execute(
            """
            SELECT s.name, s.employee_code, e.entry_date, e.reason,
                   e.specify_text, s.submitted_at
            FROM entries e
            JOIN submissions s ON s.id = e.submission_id
            ORDER BY s.submitted_at DESC, s.id DESC, e.entry_date ASC
            """
        ).fetchall()
    result = []
    for r in rows:
        result.append(
            {
                "name": r["name"],
                "employee_code": r["employee_code"],
                "date": _date_label(r["entry_date"]),
                "reason": r["reason"],
                "specify": r["specify_text"] or "",
                "submitted_at": r["submitted_at"],
            }
        )
    return result


@app.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request, _user: str = Depends(require_admin)):
    entries = fetch_all_entries()
    return templates.TemplateResponse(
        "admin.html",
        {"request": request, "entries": entries, "count": len(entries)},
    )


COLUMNS = ["Name", "Employee Code", "Date", "Reason", "Specify", "Submitted At"]


def _entry_to_row(e: dict) -> list[str]:
    return [e["name"], e["employee_code"], e["date"], e["reason"], e["specify"], e["submitted_at"]]


@app.get("/admin/export.csv")
def export_csv(_user: str = Depends(require_admin)):
    entries = fetch_all_entries()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(COLUMNS)
    for e in entries:
        writer.writerow(_entry_to_row(e))
    buffer.seek(0)
    filename = f"absences_export_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/admin/export.xlsx")
def export_xlsx(_user: str = Depends(require_admin)):
    from openpyxl import Workbook

    entries = fetch_all_entries()
    wb = Workbook()
    ws = wb.active
    ws.title = "Absences"
    ws.append(COLUMNS)
    for e in entries:
        ws.append(_entry_to_row(e))

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    filename = f"absences_export_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
