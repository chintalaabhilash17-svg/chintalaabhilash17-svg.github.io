# Contract Labour Wage Sheet Generator

SQL-backed dashboard source from the RINL Visakhapatnam Steel Plant internship project.

## Run locally

1. Install Node.js and MySQL access for the approved database.
2. Copy `.env.example` to `.env` and fill in the database settings locally.
3. From this folder, run `npm install`, then `npm start`.
4. Open `http://127.0.0.1:4000`.

The API reads `jobs`, `Attendance`, and `merged_worker_attendance`. It uses the stored monthly wage totals and returns only SQL periods that exist; the current data contains March 2025. Aadhaar values are masked by the API.

## Hosting

This directory is stored under the portfolio's underscore-prefixed `_source/` folder so GitHub Pages does not serve the app as a broken static page. GitHub Pages cannot run the Express API or MySQL. A working online deployment needs a private backend host, authenticated access, HTTPS, and a protected database connection.

This public source contains no `.env`, database dump, or worker-level payroll records. Do not add those files to the repository.
