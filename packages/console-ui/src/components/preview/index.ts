/** Stub for usePlanPreview — console-ui has no plan preview panel. */
export function usePlanPreview() {
  return {
    openPreview: (_planId: string) => {},
    openContentPreview: (_label: string, _content: string) => {},
  };
}
