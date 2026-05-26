// --- eforge:region console-shell ---
export * from './active-builds';
// --- eforge:endregion console-shell ---

// --- eforge:region now-dashboard ---
export * from './now';
// --- eforge:endregion now-dashboard ---

// --- eforge:region runs-build-entrypoints ---
export * from './runs';
// --- eforge:endregion runs-build-entrypoints ---

// --- eforge:region system-configuration-view ---
export * from './system';
// --- eforge:endregion system-configuration-view ---

// --- eforge:region activity-audit-view ---
export * from './activity';
// --- eforge:endregion activity-audit-view ---

// --- eforge:region plan-02-queue-view ---
export * from './queue';
// --- eforge:endregion plan-02-queue-view ---

// --- eforge:region plan-01-branding-fonts-label-foundation ---
export * from './labels';
// --- eforge:endregion plan-01-branding-fonts-label-foundation ---

// --- eforge:region plan-02-selector-dedup-and-run-grouping ---
// Selector deduplication, display labels, and run grouping exports are
// covered by the wildcard re-exports above (now, queue, runs, activity).
// --- eforge:endregion plan-02-selector-dedup-and-run-grouping ---
