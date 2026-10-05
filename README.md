# Abhilash Chinthala Portfolio

This repository contains the public portfolio site and portfolio-safe project previews. GitHub Pages publishes the site from the repository root.

The Contract Labour Wage Sheet Generator source is under `_source/contract-labour-wage-sheet/`. GitHub Pages ignores this underscore-prefixed directory, so it does not expose a broken app page. The source has no database credentials or payroll export. Run it with Node.js and a separately secured MySQL connection; GitHub Pages cannot run its Express API.

The project previews omit worker-level identity and payroll values. Keep `.env`, SQL exports, and identifiable payroll records out of this public repository.
