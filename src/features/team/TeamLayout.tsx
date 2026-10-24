import { Outlet } from '@tanstack/react-router'

/**
 * Layout for every /team/* route.
 * The team area has no sidebar — each child route renders its own Inset.
 * Mirrors /office structure but simpler: no sidebar context needed.
 */
export function TeamLayout() {
  return <Outlet />
}
