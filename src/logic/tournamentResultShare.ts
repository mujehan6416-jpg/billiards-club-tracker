import { calculateFinalPlacements } from './tournamentMatch'
import { findRestartTarget, restartTournamentId } from './tournamentRestart'
import type { Tournament, TournamentMatch } from '../types/tournament'

// 대회 경기결과 공유(카카오톡 문구 · 이미지 카드)용 순수 로직.
//
// 순위는 새로 추정하지 않는다. 현재 앱의 최종 순위 계산(calculateFinalPlacements)을 그대로 쓰고,
// 결승(또는 3·4위전)이 최종 승인(official)되지 않았으면 틀린 순위를 만들지 않고 "아직 확정되지 않았습니다"만 돌려준다.
// 새로 저장하는 값은 없다 — 하이런상 이름은 이 화면에서 입력한 값을 문구를 만들 때만 쓴다.

export interface ResultLine {
  /** 예: "마스터스 1위" */
  label: string
  /** 선수 이름(공동 순위면 쉼표로 이어 붙임) */
  value: string
}

export interface ResultSection {
  /** 예: "마스터스 챔피언십 경기결과" */
  title: string
  status: 'ready' | 'pending'
  lines: ResultLine[]
  /** 확정되지 않았을 때 보여줄 문구(pending) 또는 일부만 확정됐을 때의 안내 */
  notice?: string
}

export interface TournamentResultShareData {
  masters: ResultSection
  restart: ResultSection
  /** 하이런상 이름(공백 정리됨). 비어 있으면 문구·이미지에서 빼고, 화면에서 입력을 안내한다. */
  highRun: string
}

export type ParticipantNameOf = (participantId: string | null) => string

const MASTERS_TITLE = '마스터스 챔피언십 경기결과'
const RESTART_TITLE = '리스타트 챔피언십 경기결과'

/** 마스터스(본선): 1~4위. 3·4위전이 있으면 그 결과로 3위/4위를 정하고, 없으면 공동 3위로 표시한다(4위는 추정하지 않음). */
export function buildMastersSection(matches: TournamentMatch[] | null, nameOf: ParticipantNameOf): ResultSection {
  const pending: ResultSection = {
    title: MASTERS_TITLE, status: 'pending', lines: [], notice: '마스터스 결과가 아직 확정되지 않았습니다.',
  }
  if (!matches || matches.length === 0) return pending
  const placements = calculateFinalPlacements(matches)
  if (!placements.championParticipantId) return pending

  const lines: ResultLine[] = [
    { label: '마스터스 1위', value: nameOf(placements.championParticipantId) },
    { label: '마스터스 2위', value: nameOf(placements.runnerUpParticipantId) },
  ]
  const hasThirdPlaceMatch = matches.some((m) => m.playerCountInRound === 3)
  if (hasThirdPlaceMatch) {
    if (placements.fourthPlaceParticipantId !== undefined) {
      if (placements.thirdPlaceParticipantIds.length > 0) {
        lines.push({ label: '마스터스 3위', value: nameOf(placements.thirdPlaceParticipantIds[0]) })
      }
      lines.push({ label: '마스터스 4위', value: nameOf(placements.fourthPlaceParticipantId) })
      return { title: MASTERS_TITLE, status: 'ready', lines }
    }
    return { title: MASTERS_TITLE, status: 'ready', lines, notice: '3·4위전 결과가 아직 확정되지 않았습니다.' }
  }
  if (placements.thirdPlaceParticipantIds.length > 0) {
    lines.push({ label: '마스터스 공동 3위', value: placements.thirdPlaceParticipantIds.map((id) => nameOf(id)).join(', ') })
  }
  return { title: MASTERS_TITLE, status: 'ready', lines }
}

/** 리스타트: 결승 기준 1·2위만(3·4위는 표시하지 않는다). 리스타트 대회가 없거나 결승이 확정되지 않았으면 미확정. */
export function buildRestartSection(matches: TournamentMatch[] | null, nameOf: ParticipantNameOf): ResultSection {
  const pending: ResultSection = {
    title: RESTART_TITLE, status: 'pending', lines: [], notice: '리스타트 결과가 아직 확정되지 않았습니다.',
  }
  if (!matches || matches.length === 0) return pending
  const placements = calculateFinalPlacements(matches)
  if (!placements.championParticipantId) return pending
  return {
    title: RESTART_TITLE, status: 'ready',
    lines: [
      { label: '리스타트 1위', value: nameOf(placements.championParticipantId) },
      { label: '리스타트 2위', value: nameOf(placements.runnerUpParticipantId) },
    ],
  }
}

export function buildResultShareData(input: {
  mastersMatches: TournamentMatch[] | null
  mastersNameOf: ParticipantNameOf
  restartMatches: TournamentMatch[] | null
  restartNameOf: ParticipantNameOf
  highRun: string
}): TournamentResultShareData {
  return {
    masters: buildMastersSection(input.mastersMatches, input.mastersNameOf),
    restart: buildRestartSection(input.restartMatches, input.restartNameOf),
    highRun: input.highRun.trim().replace(/\s+/g, ' '),
  }
}

/**
 * 카카오톡에 붙여넣을 문구. 카톡의 굵은 글씨(*) 해석에 기대지 않고 이모지·줄바꿈만으로 읽히게 만든다.
 * 하이런상 이름이 비어 있으면 그 줄은 넣지 않는다.
 */
export function buildResultShareText(data: TournamentResultShareData): string {
  const blocks: string[] = []
  for (const section of [data.masters, data.restart]) {
    const rows = section.lines.map((l) => `${l.label}: ${l.value}`)
    if (section.status === 'pending') rows.push(section.notice ?? '')
    else if (section.notice) rows.push(section.notice)
    blocks.push([`🏆 ${section.title}`, '', ...rows].join('\n'))
  }
  if (data.highRun) blocks.push(`🎯 하이런상: ${data.highRun}`)
  return blocks.join('\n\n')
}

export type RestartResultLookup =
  | { kind: 'found'; tournament: Tournament }
  | { kind: 'none' }
  | { kind: 'ambiguous' }

/**
 * 이 본선의 리스타트 대회를 찾는다. 자동 생성할 때 쓰는 고정 id(restart-{본선 id})를 먼저 보고,
 * 없을 때만 기존 이름 규칙(본선 이름 + " 리스타트전")을 쓴다. 이름만 느슨하게 찾지 않는다.
 */
export function resolveRestartForResult(current: Tournament, tournaments: Tournament[]): RestartResultLookup {
  const fixed = tournaments.find((t) => t.id === restartTournamentId(current.id))
  if (fixed) return { kind: 'found', tournament: fixed }
  const lookup = findRestartTarget(current, tournaments)
  if (lookup.kind === 'found') return { kind: 'found', tournament: lookup.tournament }
  return lookup.kind === 'ambiguous' ? { kind: 'ambiguous' } : { kind: 'none' }
}
