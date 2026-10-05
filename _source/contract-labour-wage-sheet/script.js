document.addEventListener("DOMContentLoaded", () => {
      const $ = (id) => document.getElementById(id);
      const jobCode = $("job-code"), month = $("month"), year = $("year"), search = $("worker-search");
      const body = $("worker-table-body"), status = $("loading-workers"), message = $("selection-message");
      const details = { agency: $("filtered-agency"), periodLabel: $("filtered-period-label"), start: $("filtered-start-date"), end: $("filtered-end-date"), place: $("filtered-work-place"), department: $("filtered-department-code"), description: $("filtered-job-description") };
      const metrics = { workers: $("total-workers"), wages: $("total-wages"), average: $("average-wages"), workersNote: $("workers-note"), count: $("record-count") };
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const apiBase = window.WAGE_API_BASE || "";
      let availablePeriods = [];
      let workers = [];
      let requestId = 0;
      let detailRequestId = 0;

      $("today-label").textContent = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
      function setStatus(text, kind = "info") { status.textContent = text; status.dataset.kind = kind; }
      function setMessage(text, kind = "info") { message.textContent = text; message.dataset.kind = kind; }
      function setCell(row, value, className = "") { const cell = document.createElement("td"); cell.textContent = value == null || value === "" ? "—" : String(value); if (className) cell.className = className; row.append(cell); return cell; }
      function placeholder(title, description) {
        body.replaceChildren();
        const row = document.createElement("tr"), cell = document.createElement("td"), wrap = document.createElement("div"), strong = document.createElement("strong"), span = document.createElement("span");
        cell.className = "empty-cell"; cell.colSpan = 10; wrap.className = "empty-state"; strong.textContent = title; span.textContent = description;
        wrap.append(strong, span); cell.append(wrap); row.append(cell); body.append(row);
      }
      function money(value) {
        const amount = Number(value);
        return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount) : "₹0.00";
      }
      function numeric(value) { const amount = Number(value); return Number.isFinite(amount) ? amount : 0; }
      function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
      }
      function resetMetrics() {
        metrics.workers.textContent = "—"; metrics.wages.textContent = "—"; metrics.average.textContent = "—";
        metrics.workersNote.textContent = "Choose a job and period"; metrics.count.textContent = "0 records";
      }
      function updateMetrics(list) {
        const total = list.reduce((sum, worker) => sum + numeric(worker.Total_Wages), 0);
        metrics.workers.textContent = new Intl.NumberFormat("en-IN").format(list.length);
        metrics.wages.textContent = money(total); metrics.average.textContent = money(list.length ? total / list.length : 0);
        metrics.workersNote.textContent = list.length === 1 ? "1 worker in this period" : `${new Intl.NumberFormat("en-IN").format(list.length)} workers in this period`;
      }
      function renderWorkers() {
        const query = search.value.trim().toLocaleLowerCase();
        const filtered = workers.filter(worker => [worker.Name, worker.Skill, worker.ADHAR_ID].some(value => String(value ?? "").toLocaleLowerCase().includes(query)));
        metrics.count.textContent = `${new Intl.NumberFormat("en-IN").format(filtered.length)} ${filtered.length === 1 ? "record" : "records"}`;
        body.replaceChildren();
        if (!filtered.length) {
          placeholder(workers.length ? "No matching workers" : "No workers found", workers.length ? "Try a different name, skill or ID." : "There are no wage records for this job and period.");
          return;
        }
        const fragment = document.createDocumentFragment();
        filtered.forEach((worker, index) => {
          const row = document.createElement("tr");
          setCell(row, worker.S_no ?? index + 1, "num-cell");
          setCell(row, worker.Name, "name-cell"); setCell(row, worker.ADHAR_ID, "identity-cell"); setCell(row, formatDate(worker.Birth_Date)); setCell(row, worker.Skill);
          setCell(row, worker.Present_Days, "numeric"); setCell(row, worker.Absent_Days, "numeric");
          setCell(row, money(worker.Allowance_1), "numeric"); setCell(row, money(worker.Allowance_2), "numeric"); setCell(row, money(worker.Total_Wages), "money-cell");
          fragment.append(row);
        });
        body.append(fragment);
      }
      async function api(path) {
        const response = await fetch(`${apiBase}${path}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json();
      }
      function populateMonthsForYear(preferredMonth) {
        const selectedYear = Number(year.value);
        const monthsForYear = [...new Set(availablePeriods
          .filter(period => period.year === selectedYear)
          .map(period => period.month))].sort((a, b) => a - b);
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = monthsForYear.length ? "Choose month" : "No available months";
        month.replaceChildren(placeholder);
        monthsForYear.forEach(value => {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = months[value - 1];
          month.append(option);
        });
        const latestMonth = monthsForYear[monthsForYear.length - 1];
        const activeMonth = monthsForYear.includes(Number(preferredMonth)) ? Number(preferredMonth) : latestMonth;
        month.value = activeMonth ? String(activeMonth) : "";
        month.disabled = monthsForYear.length === 0;
      }

      async function fetchAvailablePeriods() {
        try {
          const data = await api("/api/periods");
          if (!Array.isArray(data)) throw new Error("Unexpected wage-period list");
          availablePeriods = data.map(period => ({ year: Number(period.year), month: Number(period.month) }))
            .filter(period => Number.isInteger(period.year) && Number.isInteger(period.month) && period.month >= 1 && period.month <= 12);
          if (!availablePeriods.length) {
            year.replaceChildren(); month.replaceChildren();
            year.disabled = true; month.disabled = true;
            setMessage("No monthly payroll periods are available.");
            return;
          }
          const years = [...new Set(availablePeriods.map(period => period.year))].sort((a, b) => b - a);
          year.replaceChildren(...years.map(value => {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = String(value);
            return option;
          }));
          year.disabled = false;
          year.value = String(years[0]);
          const latestMonth = Math.max(...availablePeriods.filter(period => period.year === years[0]).map(period => period.month));
          populateMonthsForYear(latestMonth);
        } catch (error) {
          const yearOption = document.createElement("option"); yearOption.value = ""; yearOption.textContent = "Periods unavailable";
          const monthOption = document.createElement("option"); monthOption.value = ""; monthOption.textContent = "Periods unavailable";
          year.replaceChildren(yearOption); month.replaceChildren(monthOption);
          year.disabled = true; month.disabled = true;
          setMessage("We couldn't load available payroll periods. Please try again later.", "error");
          console.error("Unable to load available wage periods", error);
        }
      }

      async function fetchJobCodes() {
        setMessage("Loading available job codes…");
        try {
          const data = await api("/api/job-codes");
          if (!Array.isArray(data)) throw new Error("Unexpected job list");
          jobCode.replaceChildren();
          const first = document.createElement("option"); first.value = ""; first.textContent = data.length ? "Choose a job code" : "No job codes available"; jobCode.append(first);
          data.forEach(item => { const option = document.createElement("option"); option.value = item.job_code; option.textContent = item.job_code; jobCode.append(option); });
          jobCode.disabled = !data.length;
          setMessage(data.length ? "Choose a job code to view contract details." : "No job codes are available right now.");
        } catch (error) {
          jobCode.replaceChildren(); const option = document.createElement("option"); option.value = ""; option.textContent = "Job codes unavailable"; jobCode.append(option); jobCode.disabled = true;
          setMessage("We couldn't load job codes. Please try again later.", "error"); setStatus("Wage data is temporarily unavailable.", "error");
          console.error("Unable to load job codes", error);
        }
      }
      async function fetchJobDetails(code) {
        const thisRequest = ++detailRequestId;
        Object.entries(details).forEach(([key, field]) => field.textContent = key === "periodLabel" ? "Contract period" : "—");
        details.agency.textContent = code ? "Loading…" : "Select a job code";
        if (!code) return;
        try {
          const data = await api(`/api/job-details/${encodeURIComponent(code)}`);
          if (thisRequest !== detailRequestId) return;
          details.agency.textContent = data.agency || "—"; details.periodLabel.textContent = data.period_label || "Contract period";
          details.start.textContent = formatDate(data.start_date); details.end.textContent = formatDate(data.end_date);
          details.place.textContent = data.work_place || "Not recorded"; details.department.textContent = data.department_code || "Not recorded";
          details.description.textContent = data.job_description || "Not recorded";
          if (data.contract_details_available === false) setMessage("Contract metadata is incomplete; available attendance and payroll data are shown.");
        } catch (error) {
          if (thisRequest !== detailRequestId) return;
          details.agency.textContent = "Details unavailable"; setMessage("We couldn't load this contract's details. You can still try the selected period.", "error");
          console.error("Unable to load job details", error);
        }
      }
      async function fetchWorkers() {
        const thisRequest = ++requestId;
        const code = jobCode.value, selectedMonth = month.value, selectedYear = year.value;
        workers = []; search.value = ""; search.disabled = true; resetMetrics();
        if (!code || !selectedMonth || !selectedYear) {
          setStatus("Select a job code and month to load wage records."); placeholder("Choose a job and pay period", "Your worker records will appear here once the selections are complete."); return;
        }
        setStatus("Loading wage records…"); placeholder("Loading records", "Please wait while the selected period is loaded.");
        try {
          const data = await api(`/api/merged-workers/${encodeURIComponent(code)}?month=${encodeURIComponent(selectedMonth)}&year=${encodeURIComponent(selectedYear)}`);
          if (thisRequest !== requestId) return;
          workers = Array.isArray(data) ? data : [];
          search.disabled = workers.length === 0; updateMetrics(workers); renderWorkers();
          const period = `${months[Number(selectedMonth) - 1]} ${selectedYear}`;
          setStatus(workers.length ? `${workers.length} worker ${workers.length === 1 ? "record" : "records"} loaded for ${period}.` : `No wage records found for ${period}.`);
        } catch (error) {
          if (thisRequest !== requestId) return;
          setStatus("We couldn't load wage records. Check the connection and try again.", "error"); placeholder("Wage records unavailable", "Please check the data connection and try again.");
          console.error("Unable to load wage records", error);
        }
      }
      jobCode.addEventListener("change", async () => {
        await fetchJobDetails(jobCode.value); await fetchWorkers();
      });
      month.addEventListener("change", fetchWorkers);
      year.addEventListener("change", () => { populateMonthsForYear(); fetchWorkers(); });
      search.addEventListener("input", renderWorkers);
      Promise.all([fetchAvailablePeriods(), fetchJobCodes()]);
    });
