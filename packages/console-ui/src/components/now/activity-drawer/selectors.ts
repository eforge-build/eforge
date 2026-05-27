/**
 * Drawer-local selectors re-exported from the shared activity selectors module.
 *
 * Components inside `activity-drawer/` import from this file so the drawer
 * directory is self-contained without duplicating logic.
 */
export {
  classifyFamily,
  classifyAttention,
  extractIdentifiers,
  getActivityEventSummary,
  formatTimestamp,
  formatRelativeAge,
  selectActivityRows,
  filterActivityRows,
  groupActivityRows,
  defaultActivityFilters,
} from '@/lib/selectors/activity';

export type {
  ActivityFamily,
  ActivityFilterState,
  ActivityEventRowModel,
  ActivityGroupCounts,
} from '@/lib/selectors/activity';
