// 완료된 대회의 "열람용 확정 결과" (기록용).
//
// 이 파일의 데이터는 대회 진행 엔진(대진 생성·리스타트 자동 전이·승인)을 거치지 않고,
// 실제로 확정된 결과를 그대로 옮겨 적은 것이다. 그래서:
//  - Firestore에 쓰지 않는다(읽기 전용 상수).
//  - 회원 프로필·핸디·정산·다른 대회와 연결하지 않는다.
//  - 개인 전적·승률·상대전적·랭킹·핸디 기록(logic/stats.ts)에 반영하지 않는다.
//    (types/tournament.ts와 마찬가지로 AppState·Game과 완전히 분리된 도메인이다.)
// 통계 복원은 나중에 따로 검토한다.
//
// 회원 이름 외의 개인정보(전화번호·이메일·주소 등)는 넣지 않는다.

/** 선수 한 명의 경기 기록: 이름, 친 점수, 목표 점수(핸디). 화면에는 "점수/목표"로 보인다. */
export interface ArchivedSide {
  name: string
  score: number
  target: number
}

/** 실제로 친 경기 1건. 항상 이긴 쪽을 winner에 둔다. */
export interface ArchivedGame {
  kind: 'game'
  winner: ArchivedSide
  loser: ArchivedSide
}

/** 부전승 1건 — 경기가 아니므로 점수가 없다. */
export interface ArchivedBye {
  kind: 'bye'
  name: string
}

export type ArchivedEntry = ArchivedGame | ArchivedBye

export interface ArchivedRound {
  label: string
  entries: ArchivedEntry[]
}

export interface ArchivedPlacement {
  /** 예: "우승", "준우승", "3위", "4위" */
  label: string
  name: string
}

/** 본선 / 리스타트전 같은 한 덩어리의 결과. */
export interface ArchivedStage {
  title: string
  placements: ArchivedPlacement[]
  rounds: ArchivedRound[]
}

export interface ArchivedTournament {
  id: string
  name: string
  /** 정확한 날짜가 확인된 경우에만 넣는다(YYYY-MM-DD). */
  date?: string
  /** 경기 제한시간(분). */
  timeLimitMinutes: number
  /** 이 대회에 적용된 핸디 안내(해당 선수만). */
  handicapNotes: { name: string; handicap: number }[]
  highRun: { name: string; value: number }
  stages: ArchivedStage[]
}

const g = (
  winner: string, winnerScore: number, winnerTarget: number,
  loser: string, loserScore: number, loserTarget: number,
): ArchivedGame => ({
  kind: 'game',
  winner: { name: winner, score: winnerScore, target: winnerTarget },
  loser: { name: loser, score: loserScore, target: loserTarget },
})

const bye = (name: string): ArchivedBye => ({ kind: 'bye', name })

export const ARCHIVED_TOURNAMENTS: ArchivedTournament[] = [
  {
    id: 'archive-busan-cup-2',
    name: '제2회 부산동문회장배 당구대회',
    date: '2026-10-05',
    timeLimitMinutes: 55,
    handicapNotes: [{ name: '조영일', handicap: 20 }],
    highRun: { name: '현응렬', value: 6 },
    stages: [
      {
        title: '본선',
        placements: [
          { label: '1위', name: '임진홍' },
          { label: '2위', name: '현응렬' },
          { label: '3위', name: '조영일' },
          { label: '4위', name: '엄재익' },
        ],
        rounds: [
          {
            label: '예선',
            entries: [
              g('손해수', 18, 18, '나재운', 13, 18),
              g('임진홍', 25, 25, '우연홍', 13, 17),
              g('엄재익', 9, 13, '강은기', 7, 17),
              g('김병찬', 7, 10, '김명오', 6, 13),
              g('현응렬', 22, 23, '김재홍', 8, 15),
              g('강호철', 15, 15, '이제한', 18, 21),
              g('조영일', 17, 20, '오용진', 5, 14),
              bye('송원경'),
            ],
          },
          {
            label: '8강',
            entries: [
              g('임진홍', 25, 25, '손해수', 6, 18),
              g('엄재익', 13, 13, '김병찬', 6, 10),
              g('현응렬', 23, 23, '강호철', 1, 15),
              g('조영일', 17, 20, '송원경', 8, 10),
            ],
          },
          {
            label: '4강',
            entries: [
              g('임진홍', 24, 25, '엄재익', 7, 13),
              g('현응렬', 17, 23, '조영일', 12, 20),
            ],
          },
          { label: '3·4위전', entries: [g('조영일', 20, 20, '엄재익', 7, 13)] },
          { label: '결승', entries: [g('임진홍', 25, 25, '현응렬', 11, 23)] },
        ],
      },
      {
        title: '리스타트전',
        placements: [
          { label: '우승', name: '우연홍' },
          { label: '준우승', name: '송원경' },
        ],
        rounds: [
          {
            label: '예선',
            entries: [
              g('강은기', 17, 17, '김명오', 9, 10),
              g('김재홍', 11, 15, '나재운', 9, 20),
              g('오용진', 14, 14, '이제한', 5, 21),
              bye('우연홍'),
            ],
          },
          {
            label: '8강',
            entries: [
              g('송원경', 7, 10, '강은기', 5, 17),
              g('김병찬', 6, 10, '김재홍', 8, 15),
              g('손해수', 18, 18, '오용진', 8, 14),
              g('우연홍', 17, 17, '강호철', 8, 15),
            ],
          },
          {
            label: '4강',
            entries: [
              g('송원경', 10, 10, '김병찬', 4, 10),
              g('우연홍', 17, 17, '손해수', 13, 18),
            ],
          },
          { label: '결승', entries: [g('우연홍', 17, 17, '송원경', 2, 10)] },
        ],
      },
    ],
  },
]
