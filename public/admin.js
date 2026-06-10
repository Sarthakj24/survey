(function () {
  'use strict';

  const MAX_DATES = 20;

  const messageEl = document.getElementById('message');
  const loginCard = document.getElementById('loginCard');
  const dashboard = document.getElementById('dashboard');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');

  const titleInput = document.getElementById('title');
  const datesList = document.getElementById('datesList');
  const newDate = document.getElementById('newDate');
  const addDateBtn = document.getElementById('addDateBtn');
  const dateCount = document.getElementById('dateCount');
  const saveConfigBtn = document.getElementById('saveConfigBtn');

  const shareLink = document.getElementById('shareLink');
  const copyLinkBtn = document.getElementById('copyLinkBtn');

  const respCount = document.getElementById('respCount');
  const downloadBtn = document.getElementById('downloadBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearBtn');
  const responsesTable = document.getElementById('responsesTable');

  let password = '';
  let dates = [];

  function showMessage(text, type) {
    messageEl.innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (type === 'success') {
      setTimeout(function () { messageEl.innerHTML = ''; }, 3500);
    }
  }

  function authHeaders(extra) {
    const h = Object.assign({}, extra || {});
    h['X-Admin-Password'] = password;
    return h;
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (!isNaN(d)) {
      return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    return iso;
  }

  function renderDates() {
    datesList.innerHTML = '';
    if (dates.length === 0) {
      datesList.innerHTML = '<p class="muted">No dates added yet.</p>';
    }
    dates.forEach(function (d, idx) {
      const row = document.createElement('div');
      row.className = 'date-row';
      const label = document.createElement('div');
      label.className = 'date-label';
      label.style.minWidth = '220px';
      label.textContent = formatDate(d);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () {
        dates.splice(idx, 1);
        renderDates();
      });
      row.appendChild(label);
      row.appendChild(remove);
      datesList.appendChild(row);
    });
    dateCount.textContent = dates.length + ' of ' + MAX_DATES + ' dates used';
  }

  addDateBtn.addEventListener('click', function () {
    const v = newDate.value;
    if (!v) return;
    if (dates.indexOf(v) !== -1) {
      showMessage('That date is already in the list.', 'error');
      return;
    }
    if (dates.length >= MAX_DATES) {
      showMessage('You can add at most ' + MAX_DATES + ' dates.', 'error');
      return;
    }
    dates.push(v);
    dates.sort();
    newDate.value = '';
    renderDates();
  });

  saveConfigBtn.addEventListener('click', function () {
    saveConfigBtn.disabled = true;
    fetch('/api/admin/config', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: titleInput.value.trim(), dates: dates }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        saveConfigBtn.disabled = false;
        if (!res.ok) { showMessage(res.body.error || 'Could not save.', 'error'); return; }
        dates = res.body.dates;
        renderDates();
        showMessage('Setup saved.', 'success');
      })
      .catch(function () { saveConfigBtn.disabled = false; showMessage('Network error.', 'error'); });
  });

  copyLinkBtn.addEventListener('click', function () {
    shareLink.select();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareLink.value).then(function () {
        showMessage('Link copied to clipboard.', 'success');
      });
    } else {
      document.execCommand('copy');
      showMessage('Link copied.', 'success');
    }
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderResponses(data) {
    const responses = data.responses || [];
    respCount.textContent = responses.length;
    if (responses.length === 0) {
      responsesTable.innerHTML = '<p class="muted">No responses yet.</p>';
      return;
    }
    let html = '<table><thead><tr>' +
      '<th>Name</th><th>Employee Code</th><th>Date</th><th>Reason</th><th>Details</th><th>Submitted</th>' +
      '</tr></thead><tbody>';
    responses.forEach(function (r) {
      const entries = r.entries || [];
      const submitted = new Date(r.submittedAt).toLocaleString();
      if (entries.length === 0) {
        html += '<tr><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.employeeCode) +
          '</td><td colspan="3" class="muted">No dates</td><td>' + escapeHtml(submitted) + '</td></tr>';
      }
      entries.forEach(function (e, i) {
        html += '<tr>';
        if (i === 0) {
          html += '<td rowspan="' + entries.length + '">' + escapeHtml(r.name) + '</td>';
          html += '<td rowspan="' + entries.length + '">' + escapeHtml(r.employeeCode) + '</td>';
        }
        html += '<td>' + escapeHtml(formatDate(e.date)) + '</td>';
        html += '<td>' + escapeHtml(e.reason) + '</td>';
        html += '<td>' + escapeHtml(e.details || '') + '</td>';
        if (i === 0) {
          html += '<td rowspan="' + entries.length + '">' + escapeHtml(submitted) + '</td>';
        }
        html += '</tr>';
      });
    });
    html += '</tbody></table>';
    responsesTable.innerHTML = html;
  }

  function loadResponses() {
    fetch('/api/admin/responses', { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { showMessage(res.body.error || 'Could not load responses.', 'error'); return; }
        renderResponses(res.body);
      })
      .catch(function () { showMessage('Network error.', 'error'); });
  }

  downloadBtn.addEventListener('click', function () {
    window.location = '/api/admin/export.csv?password=' + encodeURIComponent(password);
  });

  refreshBtn.addEventListener('click', loadResponses);

  clearBtn.addEventListener('click', function () {
    if (!confirm('Delete ALL responses? This cannot be undone.')) return;
    fetch('/api/admin/clear', { method: 'POST', headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { showMessage(res.body.error || 'Could not clear.', 'error'); return; }
        showMessage('All responses cleared.', 'success');
        loadResponses();
      })
      .catch(function () { showMessage('Network error.', 'error'); });
  });

  function signIn() {
    password = passwordInput.value;
    if (!password) { showMessage('Enter the admin password.', 'error'); return; }
    // Validate by hitting a protected endpoint.
    fetch('/api/admin/responses', { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { showMessage(res.body.error || 'Wrong password.', 'error'); return; }
        loginCard.classList.add('hidden');
        dashboard.classList.remove('hidden');
        messageEl.innerHTML = '';
        // Load config into the form.
        titleInput.value = res.body.config.title || '';
        dates = (res.body.config.dates || []).slice();
        renderDates();
        shareLink.value = window.location.origin + '/';
        renderResponses(res.body);
      })
      .catch(function () { showMessage('Network error.', 'error'); });
  }

  loginBtn.addEventListener('click', signIn);
  passwordInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') signIn();
  });
})();
