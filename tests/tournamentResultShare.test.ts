import { describe, it, expect } from 'vitest'
import {
  buildMastersSection, buildRestartSection, buildResultShareData, buildResultShareText, resolveRestartForResult,
} from '../src/logic/tournamentResultShare'
import type { Tournament } from '../src/types/tournament'
import { nameOfMain, playMain8, playRestart, restartFinalists } from './fixtures/resultShare'
import { decideRound, fullMain, mainWithByes } from './fixtures/restartMain'

// 가상 이름만 사용한다 — 실제 회원 정보가 아니다.

const nameOfRestart = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')

const named = (id: string, name: string, date = '2026-10-05'): Tournament => ({
  id, name, date, timeLimitMinutes: 50, status: 'draft', createdAt: '2026-10-01T00:00:00.000Z',
})

describe('마스터즈(본선) 순위 — 기존 최종 순위 계산을 그대로 사용', () => {
  it('3·4위전이 있는 대회: 1~4위가 모두 나온다(우승 1, 준우승 5, 3·4위전 승자 3 → 3위, 패자 7 → 4위)', () => {
    const s = buildMastersSection(playMain8(true), nameOfMain)
    expect(s.status).toBe('ready')
    expect(s.lines).toEqual([
      { label: '마스터즈 1위', value: '가상선수1' },
      { label: '마스터즈 2위', value: '가상선수5' },
      { label: '마스터즈 3위', value: '가상선수3' },
      { label: '마스터즈 4위', value: '가상선수7' },
    ])
    expect(s.notice).toBeUndefined()
  })

  it('3·4위전 결과를 그대로 반영한다 — 3·4위전에서 지는 쪽이 바뀌면 3위/4위도 바뀐다', () => {
    const aLoses = buildMastersSection(playMain8(true, 'all', 'A'), nameOfMain)
    expect(aLoses.lines.slice(2)).toEqual([
      { label: '마스터즈 3위', value: '가상선수7' },
      { label: '마스터즈 4위', value: '가상선수3' },
    ])
    const bLoses = buildMastersSection(playMain8(true, 'all', 'B'), nameOfMain)
    expect(bLoses.lines.slice(2)).toEqual([
      { label: '마스터즈 3위', value: '가상선수3' },
      { label: '마스터즈 4위', value: '가상선수7' },
    ])
  })

  it('3·4위전이 없는 대회: 4위는 추정하지 않고 "공동 3위"로 표시한다', () => {
    const s = buildMastersSection(playMain8(false), nameOfMain)
    expect(s.status).toBe('ready')
    expect(s.lines.map((l) => l.label)).toEqual(['마스터즈 1위', '마스터즈 2위', '마스터즈 공동 3위'])
    expect(s.lines[2].value).toBe('가상선수3, 가상선수7')
  })

  it('결승이 아직 확정되지 않았으면 순위를 만들지 않고 미확정 문구만 돌려준다', () => {
    const s = buildMastersSection(playMain8(true, 'before-final'), nameOfMain)
    expect(s).toMatchObject({ status: 'pending', lines: [], notice: '마스터즈 결과가 아직 확정되지 않았습니다.' })
    expect(buildMastersSection(null, nameOfMain).status).toBe('pending')
    expect(buildMastersSection([], nameOfMain).status).toBe('pending')
  })

  it('결승은 끝났지만 3·4위전이 아직이면 1·2위만 보여주고 3·4위전 미확정을 안내한다', () => {
    const s = buildMastersSection(playMain8(true, 'before-third'), nameOfMain)
    expect(s.status).toBe('ready')
    expect(s.lines.map((l) => l.label)).toEqual(['마스터즈 1위', '마스터즈 2위'])
    expect(s.notice).toBe('3·4위전 결과가 아직 확정되지 않았습니다.')
  })
})

describe('리스타트 순위 — 결승 기준 1·2위만', () => {
  it('리스타트 결승이 끝나면 1위·2위만 나오고 3·4위는 표시하지 않는다', () => {
    const matches = playRestart()
    const { champion, runnerUp } = restartFinalists(matches)
    const s = buildRestartSection(matches, nameOfRestart)
    expect(s.status).toBe('ready')
    expect(s.lines).toEqual([
      { label: '리스타트 1위', value: nameOfRestart(champion) },
      { label: '리스타트 2위', value: nameOfRestart(runnerUp) },
    ])
  })

  it('결승이 끝나지 않았거나 리스타트 대회가 없으면 미확정 문구', () => {
    const msg = '리스타트 결과가 아직 확정되지 않았습니다.'
    expect(buildRestartSection(playRestart(true), nameOfRestart)).toMatchObject({ status: 'pending', lines: [], notice: msg })
    expect(buildRestartSection(null, nameOfRestart)).toMatchObject({ status: 'pending', notice: msg })
  })
})

describe('리스타트는 1위·2위만 — 3·4위 결과가 있어도 표시하지 않는다(카톡 문구와 이미지 카드 공통 기준)', () => {
  it('리스타트 대회에 3·4위전까지 공식 결과가 있어도 순위 줄은 1위·2위뿐이다', () => {
    const withThirdPlace = playMain8(true) // 3·4위전 결과까지 있는 대진을 리스타트 대회라고 가정
    const s = buildRestartSection(withThirdPlace, nameOfMain)
    expect(s.lines.map((l) => l.label)).toEqual(['리스타트 1위', '리스타트 2위'])
    expect(s.notice).toBeUndefined()
  })

  it('3·4위전이 없어 마스터즈라면 "공동 3위"가 나올 대진도, 리스타트로 계산하면 1·2위뿐이다', () => {
    const noThirdPlaceMatch = playMain8(false)
    expect(buildMastersSection(noThirdPlaceMatch, nameOfMain).lines.map((l) => l.label)).toContain('마스터즈 공동 3위')
    const r = buildRestartSection(noThirdPlaceMatch, nameOfMain)
    expect(r.lines.map((l) => l.label)).toEqual(['리스타트 1위', '리스타트 2위'])
    expect(JSON.stringify(r)).not.toMatch(/3위|4위|공동/)
  })

  it('카톡 문구의 리스타트 부분에는 3위·4위·공동 3위가 나오지 않는다', () => {
    const text = buildResultShareText(buildResultShareData({
      mastersMatches: playMain8(true), mastersNameOf: nameOfMain,
      restartMatches: playMain8(true), restartNameOf: nameOfMain, highRun: '',
    }))
    const restartLines = text.split('\n').filter((l) => l.startsWith('리스타트'))
    expect(restartLines).toEqual(['리스타트 1위: 가상선수1', '리스타트 2위: 가상선수5'])
    expect(text).not.toMatch(/리스타트 (공동 )?3위|리스타트 4위/)
    // 마스터즈 쪽은 3·4위를 그대로 표시한다
    expect(text).toMatch(/마스터즈 3위: 가상선수3\n마스터즈 4위: 가상선수7/)
  })
})

describe('카카오톡 문구 — 대회 최종결과가 먼저, 그 뒤에 본선 경기 상세', () => {
  const restart = playRestart()
  const { champion, runnerUp } = restartFinalists(restart)
  const data = (highRun: string, masters = playMain8(true)) => buildResultShareData({
    mastersMatches: masters, mastersNameOf: nameOfMain, restartMatches: restart, restartNameOf: nameOfRestart, highRun,
  })
  const text = (highRun = '가상하이런', masters = playMain8(true)) => buildResultShareText(data(highRun, masters))
  /** 구역 하나의 경기 목록 — 경기 하나 = 번호 줄(승자) + 이어지는 "vs" 줄(패자). 부전승은 번호 줄 하나. */
  const entries = (t: string, title: string) => {
    const lines = t.split('\n\n').find((b) => b.startsWith(`▶ ${title}\n`))!.split('\n').slice(1)
    const out: string[] = []
    for (const l of lines) {
      if (/^\d+\. /.test(l)) out.push(l)
      else out[out.length - 1] += `\n${l}`
    }
    return out
  }

  it('"🏆 대회 최종결과"로 시작하고, 마스터즈 → 리스타트 → 하이런상 → 경기 상세 순서다', () => {
    const t = text()
    expect(t.startsWith('🏆 대회 최종결과\n\n마스터즈 1위: 가상선수1')).toBe(true)
    const order = ['대회 최종결과', '마스터즈 1위', '마스터즈 4위', '리스타트 1위', '리스타트 2위', '하이런상: 가상하이런', '▶ 결승전']
    const positions = order.map((k) => t.indexOf(k))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('최종결과 블록은 요청한 형식 그대로다(마스터즈 1~4위, 리스타트 1·2위, 하이런상, 빈 줄 구분)', () => {
    const head = text().split('\n\n▶ ')[0]
    expect(head).toBe([
      '🏆 대회 최종결과',
      '',
      '마스터즈 1위: 가상선수1',
      '마스터즈 2위: 가상선수5',
      '마스터즈 3위: 가상선수3',
      '마스터즈 4위: 가상선수7',
      '',
      `리스타트 1위: ${nameOfRestart(champion)}`,
      `리스타트 2위: ${nameOfRestart(runnerUp)}`,
      '',
      '하이런상: 가상하이런',
    ].join('\n'))
  })

  it('경기 상세는 결승전 → 3·4위전 → 준결승전 → 8강 순서로 이어진다(8명 대진에는 예선이 없다)', () => {
    const t = text()
    const heads = ['▶ 결승전', '▶ 3·4위전', '▶ 준결승전', '▶ 8강']
    const positions = heads.map((h) => t.indexOf(h))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(t).not.toContain('▶ 예선')
    expect(entries(t, '결승전')).toHaveLength(1)
    expect(entries(t, '3·4위전')).toHaveLength(1)
    expect(entries(t, '준결승전')).toHaveLength(2)
    expect(entries(t, '8강')).toHaveLength(4)
  })

  it('경기 하나는 승자 줄이 먼저, 패자는 다음 줄 "vs" 뒤 — 점수 표기는 모임탭과 같은 "점수/핸디(달성률)"', () => {
    const [final] = entries(text(), '결승전')
    // 8명 대진 결승: 가상선수1(승) 20/20(100%) vs 가상선수5 5/20(25%)
    expect(final).toBe('1. 가상선수1 20/20(100%) (승)\n    vs 가상선수5 5/20(25%)')
    // 모든 경기: 첫 줄(승자)에만 (승)이 한 번, 둘째 줄(패자)은 "    vs "로 시작하고 (승)이 없다
    const all = ['결승전', '3·4위전', '준결승전', '8강'].flatMap((title) => entries(text(), title))
    expect(all).toHaveLength(1 + 1 + 2 + 4)
    for (const e of all) {
      const [winnerLine, loserLine] = e.split('\n')
      expect(winnerLine).toMatch(/^\d+\. \S.* \(승\)$/)
      expect(loserLine.startsWith('    vs ')).toBe(true)
      expect(loserLine).not.toContain('(승)')
    }
  })

  it('경기 기록에서 B쪽이 이겨도 승자를 앞(위 줄)에 놓는다 — 승패 판정은 공식 승자 그대로', () => {
    const matches = playMain8(false).map((m) => (m.id === 'r3m1'
      ? { ...m, scoreA: 5, scoreB: 20, officialWinnerParticipantId: m.playerBParticipantId, officialLoserParticipantId: m.playerAParticipantId }
      : m))
    const [final] = entries(text('', matches), '결승전')
    expect(final).toBe('1. 가상선수5 20/20(100%) (승)\n    vs 가상선수1 5/20(25%)')
  })

  it('이름 길이가 달라도 모양이 같다 — 승자 줄과 패자 줄로 나뉘어 긴 이름이 줄 가운데서 꺾이지 않는다', () => {
    const longName = (id: string | null) => (id === 'p1' ? '아주긴이름가상선수' : nameOfMain(id))
    const t = buildResultShareText(buildResultShareData({
      mastersMatches: playMain8(true), mastersNameOf: longName, restartMatches: null, restartNameOf: nameOfRestart, highRun: '',
    }))
    expect(t).toContain('1. 아주긴이름가상선수 20/20(100%) (승)\n    vs 가상선수5 5/20(25%)')
  })

  it('달성률이 높은 쪽이 아니라 공식 승자에 (승)이 붙는다(동률을 관리자가 지정한 경우)', () => {
    const matches = playMain8(false).map((m) => (m.id === 'r3m1'
      ? { ...m, scoreA: 10, scoreB: 10, officialWinnerParticipantId: m.playerBParticipantId, officialLoserParticipantId: m.playerAParticipantId }
      : m))
    const [final] = entries(text('', matches), '결승전')
    expect(final).toBe('1. 가상선수5 10/20(50%) (승)\n    vs 가상선수1 10/20(50%)')
  })

  it('16강 이전 라운드는 "예선"으로 묶고, 부전승·기권도 자연스럽게 표시한다(15명 대진)', () => {
    const base = decideRound(mainWithByes([16]), 1) // 15명: 16강 틀, 1차에 부전승 1명(가상선수15)
    let full = decideRound(decideRound(decideRound(base, 2), 3), 4)
    // 예선 한 경기를 기권승으로 바꿔 본다
    full = full.map((m) => (m.id === 'r1m1'
      ? { ...m, resultType: 'forfeit' as const, scoreA: null, scoreB: null }
      : m))
    const t = buildResultShareText(buildResultShareData({
      mastersMatches: full, mastersNameOf: nameOfMain, restartMatches: null, restartNameOf: nameOfRestart, highRun: '',
    }))
    const heads = ['▶ 결승전', '▶ 준결승전', '▶ 8강', '▶ 예선']
    const positions = heads.map((h) => t.indexOf(h))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    const early = entries(t, '예선')
    expect(early).toHaveLength(8) // 1차 8경기 중 실제 7경기(기권 1 포함) + 부전승 1
    expect(early[0]).toBe('1. 가상선수1 (승)\n    vs 가상선수2 (기권)')
    expect(early.some((l) => l.endsWith('(부전승)') && l.includes('가상선수15'))).toBe(true)
  })

  it('32강 이상은 8강보다 앞선 모든 라운드를 "예선" 하나로 묶는다(가까운 라운드부터)', () => {
    const m32 = decideRound(decideRound(decideRound(decideRound(decideRound(fullMain(32), 1), 2), 3), 4), 5)
    const t = buildResultShareText(buildResultShareData({
      mastersMatches: m32, mastersNameOf: nameOfMain, restartMatches: null, restartNameOf: nameOfRestart, highRun: '',
    }))
    const early = entries(t, '예선')
    expect(early).toHaveLength(16 + 8) // 32강 16경기 + 16강 8경기
    expect(t.match(/▶ 예선/g)).toHaveLength(1)
    // 번호는 예선 안에서 1부터 이어진다
    expect(early[0].startsWith('1. ')).toBe(true)
    expect(early[23].startsWith('24. ')).toBe(true)
  })

  it('아직 공식 확정되지 않은 경기는 상세에 넣지 않고, 구역에 경기가 하나도 없으면 구역 자체를 만들지 않는다', () => {
    const t = text('', playMain8(true, 'before-final'))
    expect(t).not.toContain('▶ 결승전')
    expect(t).not.toContain('▶ 3·4위전')
    expect(t).toContain('▶ 준결승전')
    expect(t).toContain('마스터즈 결과가 아직 확정되지 않았습니다.')
    expect(t).not.toMatch(/마스터즈 \d위:/)
  })

  it('리스타트 경기 상세는 넣지 않는다(최종결과 1·2위 요약만)', () => {
    const t = text()
    // 리스타트 선수 이름(가상선수 번호가 본선과 다른 경기)이 상세 구역에 나오지 않는다 — 상세는 본선 경기만
    const detailPart = t.slice(t.indexOf('▶ 결승전'))
    expect(detailPart).not.toContain(nameOfRestart(champion) + ' ') // 리스타트 결승 줄이 따로 없다
    expect(detailPart.match(/▶ 결승전/g)).toHaveLength(1)
  })

  it('하이런상은 입력한 이름만 쓰고(공백 정리), 비어 있으면 그 줄을 뺀다', () => {
    expect(text('  가상   하이런 ')).toContain('\n\n하이런상: 가상 하이런\n\n▶ 결승전')
    expect(text('   ')).not.toContain('하이런상')
  })

  it('미확정이면 틀린 순위 대신 안내 문구가 들어간다', () => {
    const t = buildResultShareText(buildResultShareData({
      mastersMatches: playMain8(true, 'before-final'), mastersNameOf: nameOfMain,
      restartMatches: null, restartNameOf: nameOfRestart, highRun: '',
    }))
    expect(t.split('\n\n▶ ')[0]).toBe([
      '🏆 대회 최종결과', '', '마스터즈 결과가 아직 확정되지 않았습니다.', '', '리스타트 결과가 아직 확정되지 않았습니다.',
    ].join('\n'))
    expect(t).not.toMatch(/\d위:/)
  })
})

describe('resolveRestartForResult — 고정 id 우선, 이름 규칙은 보조', () => {
  const main = named('main-1', 'Test3')

  it('고정 id(restart-{본선 id}) 대회를 먼저 쓴다 — 이름이 달라도', () => {
    const fixed = named('restart-main-1', '이름을 고친 대회')
    expect(resolveRestartForResult(main, [main, named('x', 'Test3 리스타트전'), fixed])).toEqual({ kind: 'found', tournament: fixed })
  })

  it('고정 id가 없으면 이름 규칙(본선 이름 + " 리스타트전")으로, 느슨하게는 찾지 않는다', () => {
    const byName = named('manual', 'Test3 리스타트전')
    expect(resolveRestartForResult(main, [main, byName])).toEqual({ kind: 'found', tournament: byName })
    expect(resolveRestartForResult(main, [main, named('x', 'Test3 리스타트')]).kind).toBe('none')
    expect(resolveRestartForResult(main, [main]).kind).toBe('none')
  })

  it('같은 이름이 여러 개면 고르지 않는다', () => {
    const r = resolveRestartForResult(main, [main, named('a', 'Test3 리스타트전'), named('b', 'Test3 리스타트전')])
    expect(r.kind).toBe('ambiguous')
  })
})
