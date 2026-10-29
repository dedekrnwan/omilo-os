import { useMemo } from 'react'
import type { Id } from '../../core/domain/types'
import {
  useGoals,
  useHelpers,
  useKnowledgeSources,
  useMembers,
  useSessions,
  useSkills,
} from '../../app/queries'
import { useSession as useAuthSession } from '../../app/session'
import type { PickerSource } from './composerModel'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

/**
 * Live items for the composer pickers:
 *   @  → active helpers + company members (not you)
 *   /  → built-in commands + published skills
 *   #  → goals, docs (knowledge sources) and recent chats in the area
 */
export function usePickerSource(areaId: Id | null = null, excludeSessionId?: Id): PickerSource {
  const { data: helpers = [] } = useHelpers()
  const { data: members = [] } = useMembers()
  const { data: skills = [] } = useSkills()
  const { data: goals = [] } = useGoals(areaId)
  const { data: docs = [] } = useKnowledgeSources()
  const { data: sessions = [] } = useSessions(areaId)
  const meId = useAuthSession((s) => s.user?.id)

  return useMemo<PickerSource>(() => {
    const helperName = (id: string) => helpers.find((h) => h.id === id)?.name
    return {
      helpers: helpers
        .filter((h) => h.status !== 'paused')
        .map((h) => ({
          name: h.isChief ? h.role ?? h.name : h.name,
          mention: h.name,
          area: h.area,
          sub: h.isChief ? 'Chief of Staff' : h.role ?? h.area,
        })),
      people: members
        .filter((m) => m.userId !== meId)
        .map((m) => ({ name: m.name, initials: initials(m.name), role: m.role })),
      skills: skills
        .filter((sk) => sk.status === 'published' || sk.status === 'active')
        .map((sk) => ({
          cmd: `/skill: ${sk.name}`,
          desc: [helperName(sk.helperId), `v${sk.version}`].filter(Boolean).join(' · '),
        })),
      context: [
        ...goals.map((g) => ({ label: g.title, sub: `Goal · ${g.progress}%`, trail: 'Goal', kind: 'goal' as const, tone: 'ok' as const })),
        ...docs.slice(0, 8).map((d) => ({ label: d.title, sub: `Doc · ${d.kind}`, trail: 'Doc', kind: 'doc' as const })),
        ...sessions
          .filter((s) => s.id !== excludeSessionId)
          .slice(0, 6)
          .map((s) => ({ label: s.title, sub: `Chat · ${s.updated}`, trail: 'Chat', kind: 'chat' as const })),
      ],
    }
  }, [helpers, members, skills, goals, docs, sessions, meId, excludeSessionId])
}
