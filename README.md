# Absence Reason Form

A simple, Google Forms–style web app to collect **reasons for absence** from
employees, one reason per date. The admin configures a shared list of dates,
sends one link to everyone, and downloads the combined responses as a CSV.

- **Name** and **Employee Code** — filled by each employee
- **Dates** — configured once by the admin (up to **20**), the same for everyone
- **Reason per date** — `Log out`, `Missed regularisation`, or `Other (specify)`

No database and no third-party packages — it runs on plain Node.js and stores
data in JSON files under `data/`.

## Requirements

- Node.js 16 or newer

## Run

```bash
# Optional: set an admin password (defaults to "admin123")
ADMIN_PASSWORD=mysecret node server.js
```

Then open:

- **Employee form** — http://localhost:3000/
- **Admin panel** — http://localhost:3000/admin

You can also change the port: `PORT=8080 node server.js`.

## How to use

1. Go to `/admin` and sign in with the admin password.
2. Add the dates employees need to explain (up to 20) and **Save setup**.
3. Copy the share link and send it to your team.
4. Each person opens the link, enters their name + employee code, picks a
   reason for every date, and submits.
5. Back in the admin panel, click **Download CSV** to get everyone's responses.

### CSV format

One row per employee per date:

| Name | Employee Code | Date | Reason | Details | Submitted At |
|------|---------------|------|--------|---------|--------------|

`Details` holds the free-text explanation when the reason is "Other".

## Notes

- Responses are stored in `data/responses.json`; the date setup lives in
  `data/config.json`. The `data/` folder is created automatically and is
  git-ignored.
- Because storage is file-based, deploy this on a host with a persistent disk
  (or swap in a database) if you need responses to survive restarts.
- Set a strong `ADMIN_PASSWORD` before sharing the link, and run behind HTTPS
  in production.
