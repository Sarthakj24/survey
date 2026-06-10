(function () {
  'use strict';

  const form = document.getElementById('absenceForm');
  const noDates = document.getElementById('noDates');
  const datesContainer = document.getElementById('datesContainer');
  const messageEl = document.getElementById('message');
  const titleEl = document.getElementById('formTitle');
  const submitBtn = document.getElementById('submitBtn');

  let REASONS = [];

  function showMessage(text, type) {
    messageEl.innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearMessage() {
    messageEl.innerHTML = '';
  }

  function formatDate(iso) {
    // iso expected as YYYY-MM-DD; show a friendly label, fall back to raw.
    const parts = iso.split('-');
    if (parts.length === 3) {
      const d = new Date(iso + 'T00:00:00');
      if (!isNaN(d)) {
        return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return iso;
  }

  function buildDateRow(date) {
    const row = document.createElement('div');
    row.className = 'date-row';
    row.dataset.date = date;

    const label = document.createElement('div');
    label.className = 'date-label';
    label.textContent = formatDate(date);

    const controls = document.createElement('div');
    controls.className = 'date-controls';

    const select = document.createElement('select');
    select.className = 'reason-select';
    select.required = true;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a reason…';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    REASONS.forEach(function (r) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r === 'Other' ? 'Other (specify)' : r;
      select.appendChild(opt);
    });

    const specify = document.createElement('div');
    specify.className = 'specify';
    const specifyInput = document.createElement('input');
    specifyInput.type = 'text';
    specifyInput.className = 'specify-input';
    specifyInput.placeholder = 'Please specify the reason';
    specify.appendChild(specifyInput);

    select.addEventListener('change', function () {
      if (select.value === 'Other') {
        specify.classList.add('show');
      } else {
        specify.classList.remove('show');
        specifyInput.value = '';
      }
    });

    controls.appendChild(select);
    controls.appendChild(specify);
    row.appendChild(label);
    row.appendChild(controls);
    return row;
  }

  function loadConfig() {
    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg.title) titleEl.textContent = cfg.title;
        document.title = cfg.title || 'Absence Reason Form';
        REASONS = cfg.reasons || [];
        if (!cfg.dates || cfg.dates.length === 0) {
          noDates.classList.remove('hidden');
          return;
        }
        cfg.dates.forEach(function (d) {
          datesContainer.appendChild(buildDateRow(d));
        });
        form.classList.remove('hidden');
      })
      .catch(function () {
        showMessage('Could not load the form. Please refresh the page.', 'error');
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearMessage();

    const name = document.getElementById('name').value.trim();
    const employeeCode = document.getElementById('employeeCode').value.trim();
    if (!name || !employeeCode) {
      showMessage('Please fill in your name and employee code.', 'error');
      return;
    }

    const entries = [];
    const rows = datesContainer.querySelectorAll('.date-row');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const date = row.dataset.date;
      const reason = row.querySelector('.reason-select').value;
      const details = row.querySelector('.specify-input').value.trim();
      if (!reason) {
        showMessage('Please select a reason for ' + formatDate(date) + '.', 'error');
        return;
      }
      if (reason === 'Other' && !details) {
        showMessage('Please specify the reason for ' + formatDate(date) + '.', 'error');
        return;
      }
      entries.push({ date: date, reason: reason, details: details });
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    fetch('/api/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, employeeCode: employeeCode, entries: entries }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          showMessage(res.body.error || 'Something went wrong. Please try again.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
          return;
        }
        form.classList.add('hidden');
        showMessage('Thank you, ' + name + '! Your response has been recorded.', 'success');
      })
      .catch(function () {
        showMessage('Network error. Please try again.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      });
  });

  loadConfig();
})();
