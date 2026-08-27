import type { Tournament, TournamentEntryStatus, TournamentParticipant } from '../../types/tournament'

// 토너먼트 4A 화면 전용 표시 문구 변환. 내부 status/entryStatus 값을 그대로 화면에
// 노출하지 않기 위해 이 파일 한 곳에서만 한국어 라벨을 만든다.

/** 대회 진행 단계를 회원이 이해할 수 있는 한국어 한 줄로. */
export function tournamentStatusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'draft': return '참가 신청 중'
    case 'entryClosed': return '참가자 확정'
    case 'drawReady':
    case 'bracketFixed': return '대회 준비 중'
    case 'finished': return '대회 종료'
    case 'cancelled': return '취소됨'
  }
}

export interface EntryCounts {
  entered: number
  declined: number
  noResponse: number
  excluded: number
}

export function countEntries(participants: TournamentParticipant[]): EntryCounts {
  const counts: EntryCounts = { entered: 0, declined: 0, noResponse: 0, excluded: 0 }
  for (const p of participants) counts[p.entryStatus]++
  return counts
}

export function entryStatusLabel(status: TournamentEntryStatus): string {
  switch (status) {
    case 'entered': return '참가'
    case 'declined': return '불참'
    case 'noResponse': return '미응답'
    case 'excluded': return '관리자 제외'
  }
}

/**
 * 그 라운드에 남은 선수 수를 대회 화면 문구로 바꾼다. TournamentMatch.playerCountInRound에는
 * 숫자만 들어 있다(도메인이 "16강" 같은 한국어 문구를 갖지 않는다) — 그 숫자를 화면에서만
 * 이렇게 해석한다. 정의되지 않은 규모(대진 생성 규칙상 항상 2의 거듭제곱이므로 실사용에서는
 * 나오지 않는다)는 그대로 "N강"으로 표시해 안전하게 대응한다.
 */
export function roundLabel(playerCountInRound: number): string {
  if (playerCountInRound === 2) return '결승'
  if (playerCountInRound === 4) return '4강'
  return `${playerCountInRound}강`
}
