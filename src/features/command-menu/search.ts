/**
 * Pure search / filter helpers — no React, no side effects.
 */

import type { TabId } from './data'
import {
  RECENT_ITEMS,
  PAGES,
  ACTIONS,
  HELPERS,
  CHANNELS,
} from './data'

export interface SearchResults {
  recent: typeof RECENT_ITEMS
  pages: typeof PAGES
  actions: typeof ACTIONS
  helpers: typeof HELPERS
  channels: typeof CHANNELS
  /** True when no results at all and we should show the Ask-Chief fallback. */
  empty: boolean
  /** Leading `@` was detected — filter to helpers. */
  atMode: boolean
  /** Leading `#` was detected — filter to channels. */
  hashMode: boolean
}

function match(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function search(query: string, tab: TabId): SearchResults {
  const raw = query.trim()
  const atMode  = raw.startsWith('@')
  const hashMode = !atMode && raw.startsWith('#')
  const needle  = atMode ? raw.slice(1) : hashMode ? raw.slice(1) : raw

  if (!needle) {
    // Empty query: show defaults (recent + jump-to pages + actions)
    return {
      recent:   tab === 'all' || tab === 'chats' ? RECENT_ITEMS : [],
      pages:    tab === 'all' || tab === 'pages' ? PAGES : [],
      actions:  tab === 'all' || tab === 'actions' ? ACTIONS : [],
      helpers:  atMode || tab === 'helpers' ? HELPERS : [],
      channels: hashMode || tab === 'pages' ? [] : [],
      empty: false,
      atMode,
      hashMode,
    }
  }

  if (atMode) {
    const helpers = HELPERS.filter(h =>
      match(h.name, needle) || match(h.role, needle)
    )
    return { recent: [], pages: [], actions: [], helpers, channels: [], empty: helpers.length === 0, atMode, hashMode }
  }

  if (hashMode) {
    const channels = CHANNELS.filter(c => match(c.name, needle))
    return { recent: [], pages: [], actions: [], helpers: [], channels, empty: channels.length === 0, atMode, hashMode }
  }

  const recent   = (tab === 'all' || tab === 'chats')   ? RECENT_ITEMS.filter(r => match(r.label, needle)) : []
  const pages    = (tab === 'all' || tab === 'pages')   ? PAGES.filter(p => match(p.label, needle) || match(p.meta, needle)) : []
  const actions  = (tab === 'all' || tab === 'actions') ? ACTIONS.filter(a => match(a.label, needle)) : []
  const helpers  = (tab === 'all' || tab === 'helpers') ? HELPERS.filter(h => match(h.name, needle) || match(h.role, needle)) : []
  const channels = (tab === 'all' || tab === 'pages')   ? CHANNELS.filter(c => match(c.name, needle)) : []

  const total = recent.length + pages.length + actions.length + helpers.length + channels.length

  return { recent, pages, actions, helpers, channels, empty: total === 0, atMode, hashMode }
}
