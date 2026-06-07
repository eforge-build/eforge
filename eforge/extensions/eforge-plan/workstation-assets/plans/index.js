// --- eforge:region dom-template ---
const root = document.getElementById('root') || document.body;
root.innerHTML = `
  <header>
    <div>
      <h1>eforge-plan planning workstation</h1>
      <p class="muted" data-role="status">Starting…</p>
    </div>
    <button data-action="refresh" type="button">Refresh</button>
  </header>
  <main class="layout">
    <aside class="panel">
      <h2>Artifacts</h2>
      <ul class="artifacts" data-role="artifact-list"></ul>
      <section class="forms">
        <h2>Create plan</h2>
        <form data-role="create-form">
          <label>Session <input name="session" required></label>
          <label>Topic <input name="topic" required></label>
          <label>Planning type <select name="planningType"><option value="unknown">unknown</option><option value="feature">feature</option><option value="bugfix">bugfix</option><option value="refactor">refactor</option><option value="architecture">architecture</option><option value="docs">docs</option><option value="maintenance">maintenance</option></select></label>
          <label>Planning depth <select name="planningDepth"><option value="focused">focused</option><option value="quick">quick</option><option value="deep">deep</option></select></label>
          <label>Agent profile <input name="agentProfile"></label>
          <button type="submit">Create session plan</button>
        </form>
        <h2>Edit selected plan</h2>
        <form data-role="section-form">
          <label>Session <input name="session" required></label>
          <label>Dimension <input name="dimension" value="scope" required></label>
          <label>Content <textarea name="content" required></textarea></label>
          <button type="submit">Set section</button>
        </form>
        <form data-role="dimensions-form">
          <label>Session <input name="session" required></label>
          <label>Planning type <select name="planningType"><option value="unknown">unknown</option><option value="feature">feature</option><option value="bugfix">bugfix</option><option value="refactor">refactor</option><option value="architecture">architecture</option><option value="docs">docs</option><option value="maintenance">maintenance</option></select></label>
          <label>Planning depth <select name="planningDepth"><option value="focused">focused</option><option value="quick">quick</option><option value="deep">deep</option></select></label>
          <label><input type="checkbox" name="overwrite"> Overwrite existing dimension lists</label>
          <button type="submit">Select dimensions</button>
        </form>
        <form data-role="metadata-form">
          <label>Session <input name="session" required></label>
          <label>Profile <select name="profile"><option value="">none</option><option value="errand">errand</option><option value="excursion">excursion</option><option value="expedition">expedition</option></select></label>
          <label>Agent profile <input name="agentProfile"></label>
          <label>Open questions <textarea name="openQuestions"></textarea></label>
          <button type="submit">Update metadata</button>
        </form>
      </section>
    </aside>
    <section>
      <div class="panel actions">
        <button data-action="readiness" type="button">Check readiness</button>
        <button data-action="ready" type="button">Set ready</button>
        <button data-action="handoff" type="button">Handoff source path</button>
      </div>
      <section class="detail" data-role="detail"></section>
      <section class="board"><h2>Backlog board</h2><div class="board-grid" data-role="board"></div></section>
    </section>
  </main>
`;
// --- eforge:endregion dom-template ---

// --- eforge:region setup ---
const state = {
  artifacts: [],
  selectedKey: '',
  selectedDetail: null,
};

const el = {
  status: document.querySelector('[data-role="status"]'),
  artifactList: document.querySelector('[data-role="artifact-list"]'),
  detail: document.querySelector('[data-role="detail"]'),
  board: document.querySelector('[data-role="board"]'),
  refresh: document.querySelector('[data-action="refresh"]'),
  createForm: document.querySelector('[data-role="create-form"]'),
  sectionForm: document.querySelector('[data-role="section-form"]'),
  metadataForm: document.querySelector('[data-role="metadata-form"]'),
  dimensionsForm: document.querySelector('[data-role="dimensions-form"]'),
  readiness: document.querySelector('[data-action="readiness"]'),
  ready: document.querySelector('[data-action="ready"]'),
  handoff: document.querySelector('[data-action="handoff"]'),
};
// --- eforge:endregion setup ---

// --- eforge:region rendering-helpers ---
function setStatus(message) {
  if (el.status) el.status.textContent = message;
}

async function invoke(actionId, input = {}) {
  if (!window.eforge || typeof window.eforge.invokeAction !== 'function') {
    throw new Error('eforge workstation bridge is unavailable.');
  }
  return window.eforge.invokeAction(actionId, input);
}

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function artifactTitle(artifact) {
  const prefix = artifact.kind === 'plan-set' ? 'Plan set' : 'Plan';
  return `${prefix}: ${artifact.title || artifact.session || artifact.planSetId}`;
}

function renderArtifacts() {
  if (!el.artifactList) return;
  if (state.artifacts.length === 0) {
    el.artifactList.innerHTML = '<li class="empty">No planning artifacts found.</li>';
    return;
  }
  el.artifactList.innerHTML = state.artifacts.map((artifact) => `
    <li>
      <button class="artifact ${artifact.key === state.selectedKey ? 'selected' : ''}" data-key="${escapeText(artifact.key)}">
        <span>${escapeText(artifactTitle(artifact))}</span>
        <small>${escapeText(artifact.status)}${artifact.kind === 'plan-set' ? ` · ${escapeText(artifact.childCount)} children` : artifact.ready ? ' · ready' : ''}</small>
      </button>
    </li>
  `).join('');
  for (const button of el.artifactList.querySelectorAll('button[data-key]')) {
    button.addEventListener('click', () => selectArtifact(button.dataset.key));
  }
}

function renderBoard(board) {
  if (!el.board) return;
  const lanes = Array.isArray(board?.lanes) ? board.lanes : [];
  el.board.innerHTML = lanes.map((lane) => `
    <section class="lane">
      <h3>${escapeText(lane.title || lane.lane)}</h3>
      <ul>${(lane.items || []).map((item) => `<li><strong>${escapeText(item.id)}</strong> ${escapeText(item.title)} <small>${escapeText(item.status)}</small></li>`).join('') || '<li class="empty">No items</li>'}</ul>
    </section>
  `).join('') || '<p class="empty">No board data.</p>';
}

function renderDetail(detail) {
  if (!el.detail) return;
  if (!detail) {
    el.detail.innerHTML = '<p class="empty">Select a plan or plan set.</p>';
    clearPlanForms();
    setEditFormsEnabled(false);
    return;
  }
  if (detail.plan) {
    el.detail.innerHTML = renderPlanDetail(detail);
    fillPlanForms(detail.plan);
    setEditFormsEnabled(true);
    return;
  }
  el.detail.innerHTML = renderPlanSetDetail(detail);
  clearPlanForms();
  setEditFormsEnabled(false);
}

function renderPlanDetail(detail) {
  const plan = detail.plan;
  const readiness = detail.readiness || {};
  const diagnostics = Array.isArray(readiness.acDiagnostics) ? readiness.acDiagnostics : [];
  return `
    <article>
      <h2>${escapeText(plan.topic)}</h2>
      <p><strong>Session:</strong> <code>${escapeText(plan.session)}</code></p>
      <p><strong>Status:</strong> ${escapeText(plan.status)} · <strong>Readiness:</strong> ${readiness.ready ? 'ready' : 'not ready'}</p>
      <p><strong>Path:</strong> <code>${escapeText(detail.path)}</code></p>
      <h3>Missing dimensions</h3>
      <p>${escapeText((readiness.missingDimensions || []).join(', ') || 'None')}</p>
      <h3>Acceptance criteria diagnostics</h3>
      <ul>${diagnostics.map((item) => `<li>${escapeText(item.message || JSON.stringify(item))}</li>`).join('') || '<li class="empty">None</li>'}</ul>
      <h3>Body</h3>
      <pre>${escapeText(plan.body)}</pre>
    </article>
  `;
}

function renderPlanSetDetail(detail) {
  const planSet = detail.planSet || {};
  const children = Array.isArray(planSet.children) ? planSet.children : [];
  return `
    <article>
      <h2>${escapeText(planSet.title || planSet.id)}</h2>
      <p><strong>Plan set:</strong> <code>${escapeText(planSet.id)}</code> · <strong>Status:</strong> ${escapeText(planSet.status)} · <strong>Strategy:</strong> ${escapeText(planSet.strategy)}</p>
      <p><strong>Manifest:</strong> <code>${escapeText(detail.manifestPath)}</code></p>
      <p><strong>Validation:</strong> ${detail.validation?.ok ? 'ok' : 'has diagnostics'}</p>
      <h3>Children</h3>
      <ul>${children.map((child) => `<li><strong>${escapeText(child.id)}</strong> ${escapeText(child.status)} ${child.buildable ? 'buildable' : 'not buildable'} <small>${escapeText(child.file)}</small></li>`).join('') || '<li class="empty">No children</li>'}</ul>
      ${detail.anchorContent ? `<h3>Anchor</h3><pre>${escapeText(detail.anchorContent)}</pre>` : ''}
    </article>
  `;
}

function setEditFormsEnabled(enabled) {
  for (const form of [el.sectionForm, el.metadataForm, el.dimensionsForm]) {
    for (const field of form?.elements || []) {
      field.disabled = !enabled;
    }
  }
}

function clearPlanForms() {
  if (el.sectionForm) {
    el.sectionForm.reset();
    el.sectionForm.elements.dimension.value = 'scope';
  }
  if (el.metadataForm) el.metadataForm.reset();
  if (el.dimensionsForm) el.dimensionsForm.reset();
}

function fillPlanForms(plan) {
  clearPlanForms();
  for (const form of [el.sectionForm, el.metadataForm, el.dimensionsForm]) {
    if (form?.elements.session) form.elements.session.value = plan.session;
  }
  if (el.metadataForm) {
    el.metadataForm.elements.profile.value = plan.profile || '';
    el.metadataForm.elements.agentProfile.value = plan.agent_profile || '';
    el.metadataForm.elements.openQuestions.value = (plan.open_questions || []).join('\n');
  }
  if (el.dimensionsForm) {
    el.dimensionsForm.elements.planningType.value = plan.planning_type || 'unknown';
    el.dimensionsForm.elements.planningDepth.value = plan.planning_depth || 'focused';
    el.dimensionsForm.elements.overwrite.checked = false;
  }
}

async function refresh() {
  setStatus('Loading planning artifacts…');
  const result = await invoke('list-planning-artifacts', {});
  state.artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  renderBoard(result.board);
  renderArtifacts();
  setStatus('Planning artifacts loaded.');
}

// --- eforge:endregion rendering-helpers ---

// --- eforge:region action-handlers ---
async function selectArtifact(key) {
  const artifact = state.artifacts.find((item) => item.key === key);
  if (!artifact) return;
  state.selectedKey = key;
  renderArtifacts();
  setStatus(`Loading ${artifactTitle(artifact)}…`);
  state.selectedDetail = artifact.kind === 'plan-set'
    ? await invoke('show-session-plan-set', { planSetId: artifact.planSetId })
    : await invoke('show-session-plan', { session: artifact.session });
  renderDetail(state.selectedDetail);
  setStatus(`${artifactTitle(artifact)} loaded.`);
}

function formValue(form, name) {
  return String(form.elements[name]?.value || '').trim();
}

el.refresh?.addEventListener('click', () => refresh().catch(showError));

el.createForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = {
    session: formValue(form, 'session'),
    topic: formValue(form, 'topic'),
    planningType: formValue(form, 'planningType') || undefined,
    planningDepth: formValue(form, 'planningDepth') || undefined,
    agentProfile: formValue(form, 'agentProfile') || undefined,
  };
  invoke('create-session-plan', input).then(refresh).catch(showError);
});

el.sectionForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const session = selectedPlanSession();
  if (!session) return;
  invoke('set-session-plan-section', {
    session,
    dimension: formValue(form, 'dimension'),
    content: String(form.elements.content.value || ''),
  }).then((detail) => {
    state.selectedDetail = detail;
    renderDetail(detail);
    return refresh();
  }).catch(showError);
});

el.metadataForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const session = selectedPlanSession();
  if (!session) return;
  invoke('update-session-plan-metadata', {
    session,
    profile: formValue(form, 'profile') || null,
    agentProfile: formValue(form, 'agentProfile') || null,
    openQuestions: String(form.elements.openQuestions.value || '').split('\n').map((line) => line.trim()).filter(Boolean),
  }).then((detail) => {
    state.selectedDetail = detail;
    renderDetail(detail);
    return refresh();
  }).catch(showError);
});

el.dimensionsForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const session = selectedPlanSession();
  if (!session) return;
  invoke('select-session-plan-dimensions', {
    session,
    planningType: formValue(form, 'planningType') || undefined,
    planningDepth: formValue(form, 'planningDepth') || undefined,
    overwrite: Boolean(form.elements.overwrite.checked),
  }).then((detail) => {
    state.selectedDetail = detail;
    renderDetail(detail);
    return refresh();
  }).catch(showError);
});

el.readiness?.addEventListener('click', () => selectedPlanAction('check-session-plan-readiness'));
el.ready?.addEventListener('click', () => selectedPlanAction('set-session-plan-ready'));
el.handoff?.addEventListener('click', () => {
  const session = selectedPlanSession();
  if (!session) return;
  const confirmed = window.confirm(`Hand off session plan ${session} as a build source path?`);
  if (!confirmed) return;
  invoke('handoff-session-plan', { session }).then((result) => {
    setStatus(result.command || result.message || JSON.stringify(result));
    renderDetail({ plan: state.selectedDetail?.plan, readiness: result.readiness, path: state.selectedDetail?.path });
  }).catch(showError);
});

function selectedPlanSession() {
  const artifact = state.artifacts.find((item) => item.key === state.selectedKey);
  if (!artifact || artifact.kind !== 'plan') {
    setStatus('Select a flat session plan first.');
    return '';
  }
  return artifact.session;
}

function selectedPlanAction(actionId) {
  const session = selectedPlanSession();
  if (!session) return;
  invoke(actionId, { session }).then((result) => {
    setStatus(result.message || `${actionId} complete.`);
    if (result.plan || result.readiness) renderDetail({ plan: result.plan || state.selectedDetail?.plan, readiness: result.readiness, path: state.selectedDetail?.path });
    return refresh();
  }).catch(showError);
}

// --- eforge:endregion action-handlers ---

// --- eforge:region initialization ---
function showError(error) {
  setStatus(error instanceof Error ? error.message : String(error));
}

clearPlanForms();
setEditFormsEnabled(false);
refresh().catch(showError);
// --- eforge:endregion initialization ---
