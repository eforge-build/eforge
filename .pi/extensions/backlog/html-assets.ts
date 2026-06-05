// Static page assets for the generated backlog board: CSS and the client-side filter/group script.
// Both are pure string builders with no dependency on the HTML render model, kept here to keep html.ts under the size cap.

// --- eforge:region backlog-css ---
export function css(): string {
	return `
:root{
	color-scheme:dark;
	--bg:#0b0e14;--col:#11151d;--card:#161b24;--card-hi:#1b212c;--line:#252c39;--line-2:#2f3848;
	--text:#e6edf3;--muted:#8b97a8;--faint:#5b6678;--accent:#58a6ff;
	--ok:#3fb950;--warn:#d2a022;--bad:#f0613a;
	--st-candidate:#7d8aa0;--st-planned:#58a6ff;--st-active:#3fb950;--st-shipped:#a371f7;--st-stale:#d2a022;--st-superseded:#6e7681;
	--p-high:#f0613a;--p-medium:#d2a022;--p-low:#5b6678;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em}
main{max-width:1500px;margin:0 auto;padding:1rem 1.25rem 3rem}

.topbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;padding:.9rem 1.25rem;background:rgba(11,14,20,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
.topbar-title{display:flex;align-items:center;gap:.6rem}
.topbar-title h1{font-size:1.15rem;font-weight:650;margin:0;letter-spacing:-.01em}
.dot-brand{width:.7rem;height:.7rem;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.18)}
.gen{color:var(--faint);font-size:.78rem}
.gen code{background:#0a0d13;border:1px solid var(--line);border-radius:.3rem;padding:.05rem .3rem;color:var(--muted)}

.stats{display:flex;gap:.4rem;flex-wrap:wrap}
.stat{display:inline-flex;align-items:baseline;gap:.35rem;background:var(--col);border:1px solid var(--line);border-radius:.5rem;padding:.3rem .6rem;font-size:.76rem;color:var(--muted)}
.stat strong{font-size:.95rem;color:var(--text);font-weight:650}
.stat-ready strong{color:var(--ok)}
.stat-bad strong{color:var(--bad)}
.stat-warn strong{color:var(--warn)}

.toolbar{display:flex;justify-content:space-between;gap:.75rem;align-items:center;flex-wrap:wrap;margin:1.1rem 0}
.toolbar input{flex:1;min-width:min(28rem,100%);background:var(--col);color:var(--text);border:1px solid var(--line);border-radius:.55rem;padding:.5rem .75rem;font-size:.9rem}
.toolbar input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.15)}
.filters{display:flex;gap:.35rem;flex-wrap:wrap}
.filter{border:1px solid var(--line);background:var(--col);color:var(--muted);border-radius:.5rem;padding:.4rem .7rem;cursor:pointer;font-size:.82rem;transition:.12s}
.filter:hover{color:var(--text);border-color:var(--line-2)}
.filter.active{color:var(--text);border-color:var(--accent);background:rgba(88,166,255,.12)}
.toolbar-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.group-label{font-size:.72rem;color:var(--faint);align-self:center;padding:0 .15rem}
.epic-select{background:var(--col);color:var(--text);border:1px solid var(--line);border-radius:.5rem;padding:.4rem .6rem;font-size:.82rem;max-width:16rem}
.epic-select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.15)}

.epic-panel{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1.1rem}
.epic-summary{display:inline-flex;align-items:center;gap:.4rem;background:rgba(88,166,255,.08);color:var(--accent);border:1px solid var(--line);border-radius:.5rem;padding:.3rem .55rem;font-size:.78rem;cursor:pointer;transition:.12s}
.epic-summary:hover{border-color:var(--accent)}
.epic-summary.active{border-color:var(--accent);background:rgba(88,166,255,.18)}
.epic-summary.missing{color:var(--bad);border-style:dashed;background:rgba(240,97,58,.08)}
.epic-summary-none{color:var(--muted);background:var(--col);cursor:default}
.epic-summary-count{background:var(--card);border:1px solid var(--line);border-radius:999px;min-width:1.4rem;text-align:center;padding:.02rem .35rem;font-size:.72rem;color:var(--muted)}

.cycles,.recommendations-panel{margin:0 0 1.1rem;padding:.7rem .9rem;background:rgba(240,97,58,.07);border:1px solid rgba(240,97,58,.4);border-radius:.6rem}
.recommendations-panel{background:rgba(88,166,255,.06);border-color:rgba(88,166,255,.3)}
.recommendations-head{display:flex;gap:.6rem;align-items:baseline;margin-bottom:.35rem}
.recommendations-panel>p{margin:.1rem 0 .6rem;color:var(--text);max-width:90ch}
.cycles-tag{display:inline-block;font-size:.72rem;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:var(--bad);margin-bottom:.35rem}.recommendations-panel .cycles-tag{color:var(--accent)}
.rec-section{margin:.5rem 0 .1rem}
.rec-label{display:block;font-size:.7rem;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:.4rem}
.rec-rail{display:flex;gap:.5rem;flex-wrap:wrap}
.rec-step{display:inline-flex;align-items:center;gap:.45rem;background:var(--card);border:1px solid var(--line);border-radius:.5rem;padding:.32rem .6rem .32rem .34rem;max-width:24rem;color:var(--text);transition:.12s}
.rec-step:hover{border-color:var(--accent);background:var(--card-hi);text-decoration:none}
.rec-rank{display:inline-flex;align-items:center;justify-content:center;width:1.35rem;height:1.35rem;border-radius:50%;background:rgba(88,166,255,.16);color:var(--accent);font-size:.74rem;font-weight:700;flex:0 0 auto}
.rec-step-title{font-size:.82rem;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rec-details{margin-top:.5rem;border-top:1px solid var(--line);padding-top:.45rem}
.rec-details>summary{cursor:pointer;color:var(--muted);font-size:.78rem;list-style:none}
.rec-details>summary::-webkit-details-marker{display:none}
.rec-details>summary::before{content:"▸ ";color:var(--faint)}
.rec-details[open]>summary::before{content:"▾ "}
.rec-details>summary:hover{color:var(--text)}
.rec-group-list{margin:.1rem 0 .35rem;padding-left:0;list-style:none}
.rec-group-list>li{margin:.45rem 0}
.rec-group-head{margin-bottom:.28rem}
.rec-chips{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
.rec-chip{display:inline-block;font-size:.74rem;color:var(--accent);background:rgba(88,166,255,.08);border:1px solid var(--line);border-radius:.35rem;padding:.06rem .42rem;max-width:20rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.rec-chip:hover{border-color:var(--accent);text-decoration:none}
.rec-chip-blocked{color:var(--bad);background:rgba(240,97,58,.1);border-color:rgba(240,97,58,.3)}
.rec-chip-blocking{color:var(--warn);background:rgba(210,160,34,.1);border-color:rgba(210,160,34,.3)}
.rec-blocked-by{font-size:.72rem;color:var(--faint)}
.rec-note{display:block;font-size:.76rem;color:var(--muted);margin-top:.22rem}
.rec-rationale{margin:.1rem 0 .35rem;padding-left:1.1rem;list-style:disc;color:var(--muted)}
.rec-rationale li{margin:.15rem 0}
.cycles ul{margin:0;padding-left:1.1rem}
.cycles code{background:#0a0d13;border:1px solid var(--line);border-radius:.3rem;padding:.03rem .28rem}

.board{display:flex;gap:.9rem;align-items:flex-start;overflow-x:auto;padding-bottom:.5rem}
.col{flex:1 1 0;min-width:300px;max-width:520px;background:var(--col);border:1px solid var(--line);border-radius:.75rem;border-top:2px solid var(--st);overflow:hidden}
.status-candidate{--st:var(--st-candidate)}.status-planned{--st:var(--st-planned)}.status-active{--st:var(--st-active)}
.status-shipped{--st:var(--st-shipped)}.status-stale{--st:var(--st-stale)}.status-superseded{--st:var(--st-superseded)}
.epic-col{--st:var(--accent)}.epic-col.missing{--st:var(--bad)}.epic-col.none{--st:var(--faint)}
.rec-col-next{--st:var(--accent)}.rec-col-blocked{--st:var(--bad)}.rec-col-other{--st:var(--faint)}.rec-col-closed{--st:var(--st-superseded)}
.col-head{position:sticky;top:0;display:flex;align-items:center;gap:.5rem;padding:.65rem .8rem;background:var(--col);border-bottom:1px solid var(--line)}
.col-dot{width:.55rem;height:.55rem;border-radius:50%;background:var(--st)}
.col-name{font-weight:650;font-size:.9rem}
.col-count{margin-left:auto;font-size:.78rem;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;min-width:1.5rem;text-align:center;padding:.05rem .4rem}
.col-body{display:flex;flex-direction:column;gap:.6rem;padding:.7rem}
.col-empty{color:var(--faint);font-size:.82rem;text-align:center;padding:1.2rem 0;margin:0}

.card{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--p);border-radius:.6rem;padding:.7rem .8rem;scroll-margin-top:5rem;transition:.12s}
.card:hover{border-color:var(--line-2);background:var(--card-hi)}
.card:target{border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.2)}
.priority-high{--p:var(--p-high)}.priority-medium{--p:var(--p-medium)}.priority-low{--p:var(--p-low)}
.card[data-blocked=true]{border-left-color:var(--bad)}
.card[data-closed=true]{opacity:.62}
.card-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem}
.prio{display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;color:var(--muted);text-transform:capitalize}
.prio-dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--p)}
.badges{margin-left:auto;display:flex;gap:.3rem;flex-wrap:wrap}
.badge{font-size:.68rem;font-weight:600;border-radius:.35rem;padding:.08rem .4rem;border:1px solid transparent}
.badge-bad{color:var(--bad);background:rgba(240,97,58,.12);border-color:rgba(240,97,58,.35)}
.badge-warn{color:var(--warn);background:rgba(210,160,34,.12);border-color:rgba(210,160,34,.35)}
.badge-ok{color:var(--ok);background:rgba(63,185,80,.12);border-color:rgba(63,185,80,.3)}
.badge-rec{color:var(--accent);background:rgba(88,166,255,.14);border-color:rgba(88,166,255,.4)}
.card-title{font-size:.95rem;font-weight:600;line-height:1.3;margin:.1rem 0 .25rem}
.card-id{display:block;color:var(--faint);font-size:.72rem;margin-bottom:.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tags{display:flex;flex-wrap:wrap;gap:.3rem;margin:.35rem 0 0}
.tag{font-size:.7rem;color:var(--muted);background:var(--col);border:1px solid var(--line);border-radius:.35rem;padding:.06rem .4rem}
.epic-tag{color:var(--accent);background:rgba(88,166,255,.08)}.epic-tag.missing{color:var(--bad);border-color:var(--bad);border-style:dashed}
.lane-tag{color:var(--st-shipped);background:rgba(163,113,247,.12);border-color:rgba(163,113,247,.3)}

.deps{margin-top:.5rem;display:flex;flex-direction:column;gap:.35rem}
.dep-row{display:flex;gap:.4rem;align-items:baseline;flex-wrap:wrap}
.dep-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);flex:0 0 auto;padding-top:.05rem}
.dep-chips{display:flex;flex-wrap:wrap;gap:.25rem}
.chip{font-size:.72rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);background:rgba(88,166,255,.08);border:1px solid var(--line);border-radius:.35rem;padding:.04rem .35rem;max-width:14rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip.blocking{color:var(--bad);background:rgba(240,97,58,.1);border-color:rgba(240,97,58,.35)}
.chip.missing{color:var(--bad);border-color:var(--bad);border-style:dashed}
.chip.hidden-ref{color:var(--muted);background:var(--col)}
.unblock-note{margin-top:.5rem;font-size:.76rem;color:var(--warn);display:flex;gap:.4rem;align-items:baseline}
.unblock-label{font-size:.64rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);border:1px solid rgba(210,160,34,.35);border-radius:.3rem;padding:.02rem .3rem;flex:0 0 auto}

.details{margin-top:.55rem}
.details summary{cursor:pointer;color:var(--muted);font-size:.78rem;list-style:none}
.details summary::-webkit-details-marker{display:none}
.details summary::before{content:"▸ ";color:var(--faint)}
.details[open] summary::before{content:"▾ "}
.details summary:hover{color:var(--text)}
.detail-section{margin-top:.5rem}
.detail-section h4{margin:0 0 .25rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
pre{white-space:pre-wrap;word-break:break-word;background:#0a0d13;border:1px solid var(--line);border-radius:.45rem;padding:.55rem;color:#cdd9e5;font-size:.78rem;max-height:16rem;overflow:auto;margin:0}

.empty{color:var(--muted);padding:3rem;text-align:center}
.is-hidden{display:none!important}
@media (max-width:760px){.board{flex-direction:column}.col{max-width:none;width:100%}.toolbar input{min-width:100%}}
`;
}
// --- eforge:endregion backlog-css ---

// --- eforge:region backlog-client-script ---
export function clientScript(): string {
	return `(() => {
	const search = document.getElementById('search');
	const buttons = [...document.querySelectorAll('[data-filter]')];
	const groupButtons = [...document.querySelectorAll('[data-group]')];
	const epicSelect = document.getElementById('epic-filter');
	const epicChips = [...document.querySelectorAll('[data-epic-filter]')];
	const nodes = [...document.querySelectorAll('[data-backlog-card]')];
	const columns = [...document.querySelectorAll('.col')];
	const statusBoard = document.querySelector('[data-board=status]');
	const epicBoard = document.querySelector('[data-board=epic]');
	const recBoard = document.querySelector('[data-board=recommended]');
	const cardHome = new Map();
	for (const card of nodes) cardHome.set(card, card.parentElement);
	let filter = 'all';
	let group = 'status';
	let epicFilter = '';
	function matchesFilter(node) {
		if (filter === 'ready') return node.dataset.ready === 'true';
		if (filter === 'blocked') return node.dataset.blocked === 'true';
		if (filter === 'review') return node.dataset.review === 'true';
		if (filter === 'closed') return node.dataset.closed === 'true';
		return true;
	}
	function matchesEpic(node) {
		return !epicFilter || (node.dataset.epic || '') === epicFilter;
	}
	function apply() {
		const q = (search && search.value || '').trim().toLowerCase();
		for (const node of nodes) {
			const text = node.dataset.search || '';
			node.classList.toggle('is-hidden', Boolean(q && !text.includes(q)) || !matchesFilter(node) || !matchesEpic(node));
		}
		for (const col of columns) {
			const visible = col.querySelectorAll('[data-backlog-card]:not(.is-hidden)').length;
			const count = col.querySelector('[data-count]');
			if (count) count.textContent = visible;
			col.classList.toggle('is-hidden', visible === 0);
		}
	}
	function recRankOf(node) {
		return node.dataset.recRank ? Number(node.dataset.recRank) : Infinity;
	}
	function placeCard(card) {
		let target = null;
		if (group === 'epic' && epicBoard) target = epicBoard.querySelector('[data-epic-col="' + (card.dataset.epic || '') + '"] .col-body');
		else if (group === 'recommended' && recBoard) target = recBoard.querySelector('[data-rec-col="' + (card.dataset.recCol || 'other') + '"] .col-body');
		(target || cardHome.get(card)).appendChild(card);
	}
	function layout() {
		const ordered = group === 'recommended' ? [...nodes].sort((a, b) => recRankOf(a) - recRankOf(b)) : nodes;
		for (const card of ordered) placeCard(card);
		if (statusBoard) statusBoard.classList.toggle('is-hidden', group !== 'status');
		if (epicBoard) epicBoard.classList.toggle('is-hidden', group !== 'epic');
		if (recBoard) recBoard.classList.toggle('is-hidden', group !== 'recommended');
	}
	function syncEpicChips() {
		for (const chip of epicChips) chip.classList.toggle('active', chip.dataset.epicFilter === epicFilter);
	}
	if (search) search.addEventListener('input', apply);
	for (const button of buttons) button.addEventListener('click', () => {
		filter = button.dataset.filter || 'all';
		for (const other of buttons) other.classList.toggle('active', other === button);
		apply();
	});
	for (const button of groupButtons) button.addEventListener('click', () => {
		group = button.dataset.group || 'status';
		for (const other of groupButtons) other.classList.toggle('active', other === button);
		layout();
		apply();
	});
	if (epicSelect) epicSelect.addEventListener('change', () => {
		epicFilter = epicSelect.value;
		syncEpicChips();
		apply();
	});
	for (const chip of epicChips) chip.addEventListener('click', () => {
		epicFilter = epicFilter === chip.dataset.epicFilter ? '' : (chip.dataset.epicFilter || '');
		if (epicSelect) epicSelect.value = epicFilter;
		syncEpicChips();
		apply();
	});
})();`;
}
// --- eforge:endregion backlog-client-script ---
