// Scroll a backlog board card into view by its id. No-op when the item is
// filtered out of the current board view or not in the DOM. Shared by the
// recommendations flow and the curation preview so "go to this item" behaves
// the same everywhere.
export function focusBoardItem(id: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(`board-item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
