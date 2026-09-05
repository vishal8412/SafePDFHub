/**
 * Visual density modes for the Studio Pages sidebar.
 *
 * The mode changes presentation only. It must never change logical page
 * identity, ordering, selection or PDF thumbnail ownership.
 */
export type StudioSidebarPageView =
  | 'comfortable'
  | 'compact'
  | 'grid';
