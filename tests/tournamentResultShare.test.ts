import { describe, it, expect } from 'vitest'
import {
  buildMastersSection, buildRestartSection, buildResultShareData, buildResultShareText, resolveRestartForResult,
} from '../src/logic/tournamentResultShare'
import type { Tournament } from '../src/types/tournament'
import { nameOfMain, playMain8, playRestart, restartFinalists } from './fixtures/resultShare'

// 가상 이름만 사용한다 — 실제 회원 정보가 아니다.

const nameOfRestart = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')

const named = (id: string, name: string, date = '2026-10-05'): Tournament => ({
  id, name, date, timeLimitMinutes: 50, status: 'draft', createdAt: '2026-10-01T00:00:00.000Z',
})

describe('마스터스(본선) 순위 — 기존 최종 순위 계산을 그대로 사용', () => {
  it('3·4위전이 있는 대회: 1~4위가 모두 나온다(우승 1, 준우승 5, 3·4위전 승자 3 → 3위, 패자 7 → 4위)', () => {
    const s = buildMastersSection(playMain8(true), nameOfMain)
    expect(s.status).toBe('ready')
    expect(s.lines).toEqual([
      { label: '마스터스 1위', value: '가상선수1' },
      { label: '마스터스 2위', value: '가상선수5' },
      { label: '마스터스 3위', value: '가상선수3' },
      { label: '마스터스 4위', value: '가상선수7' },
    ])
    expect(s.notice).toBeUndefined()
  })

  it('3·4위전 결과를 그대로 반영한다 — 3·4위전에서 지는 쪽이 바뀌면 3위/4위도 바뀐다', () => {
    const aLoses = buildMastersSection(playMain8(true, 'all', 'A'), nameOfMain)
    expect(aLoses.lines.slice(2)).toEqual([
      { label: '마스터스 3위', value: '가상선수7' },
      { label: '마스터스 4위', value: '가상선수3' },
    ])
    const bLoses = buildMastersSection(playMain8(true, 'all', 'B'), nameOfMain)
    expect(bLoses.lines.slice(2)).toEqual([
      { label: '마스터스 3위', value: '가상선수3' },
      { label: '마스터스 4위', value: '가상선수7' },
    ])
  })

  it('3·4위전이 없는 대회: 4위는 추정하지 않고 "공동 3위"로 표시한다', () => {
    const s = buildMastersSection(playMain8(false), nameOfMain)
    expect(s.status).toBe('ready')
    expect(s.lines.map((l) => l.label)).toEqual(['마스터스 1위', '마스터스 2위', '마스터스 공동 3위'])
    expect(s.lines[2].value).toBe('가상선수3, 가상선수7')
  })

  it('결승이 아직 확정되지 않았으면 순위를 만들지 않고 미확정 문구만 돌려준다', () => {
    const s = buildMastersSection(playMain8(true, 'before-final'), nameOfMain)
    expect(s).toMatchObject({ status: 'pending', lines: [], notice: '마스터스 결과가 아직 확정되지 않았습니다.' })
    expect(buildMastersSection(null, nameOfMain).status).toBe('pending')
    expect(buildMastersSection([], nameOfMain).status).toBe('pending')
  })

  it('결승은 끝났지만 3·4위전이 아직이면 1·2위만 보여주고 3·4위전 미확정을 안내한다', () => {
    const s = buildMastersSection(playMain8(true, 'before-third'), nameOfMain)
    expect(s.status).toBe('ready')
    expect(s.lines.map((l) => l.label)).toEqual(['마스터스 1위', '마스터스 2위'])
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

  it('카톡 문구의 리스타트 부분에는 3위·4위·공동 3위가 나오지 않는다', () => {
    const text = buildResultShareText(buildResultShareData({
      mastersMatches: playMain8(true), mastersNameOf: nameOfMain,
      restartMatches: playMain8(true), restartNameOf: nameOfMain, highRun: '',
    }))
    const restartPart = text.slice(text.indexOf('리스타트 챔피언십 경기결과'))
    expect(restartPart).toContain('리스타트 1위: 가상선수1')
    expect(restartPart).toContain('리스타트 2위: 가상선수5')
    expect(restartPart).not.toMatch(/3위|4위/)
    // 마스터스 쪽은 3·4위를 그대로 표시한다
    expect(text.slice(0, text.indexOf('리스타트 챔피언십 경기결과'))).toMatch(/마스터스 3위: 가상선수3[\s\S]*마스터스 4위: 가상선수7/)
  })
})

describe('카카오톡 문구', () => {
  const restart = playRestart()
  const { champion, runnerUp } = restartFinalists(restart)
  const data = (highRun: string) => buildResultShareData({
    mastersMatches: playMain8(true), mastersNameOf: nameOfMain, restartMatches: restart, restartNameOf: nameOfRestart, highRun,
  })

  it('요청한 형식 그대로(이모지 제목, 빈 줄, 순위 줄, 하이런상)', () => {
    expect(buildResultShareText(data('가상하이런'))).toBe([
      '🏆 마스터스 챔피언십 경기결과',
      '',
      '마스터스 1위: 가상선수1',
      '마스터스 2위: 가상선수5',
      '마스터스 3위: 가상선수3',
      '마스터스 4위: 가상선수7',
      '',
      '🏆 리스타트 챔피언십 경기결과',
      '',
      `리스타트 1위: ${nameOfRestart(champion)}`,
      `리스타트 2위: ${nameOfRestart(runnerUp)}`,
      '',
      '🎯 하이런상: 가상하이런',
    ].join('\n'))
  })

  it('하이런상 이름은 공백을 정리해서 쓰고, 비어 있으면 그 줄을 뺀다', () => {
    expect(buildResultShareText(data('  가상   하이런 '))).toContain('🎯 하이런상: 가상 하이런')
    const none = buildResultShareText(data('   '))
    expect(none).not.toContain('하이런상')
    expect(none.endsWith(`리스타트 2위: ${nameOfRestart(runnerUp)}`)).toBe(true)
  })

  it('미확정이면 틀린 순위 대신 안내 문구가 들어간다', () => {
    const text = buildResultShareText(buildResultShareData({
      mastersMatches: playMain8(true, 'before-final'), mastersNameOf: nameOfMain,
      restartMatches: null, restartNameOf: nameOfRestart, highRun: '',
    }))
    expect(text).toBe([
      '🏆 마스터스 챔피언십 경기결과', '', '마스터스 결과가 아직 확정되지 않았습니다.', '',
      '🏆 리스타트 챔피언십 경기결과', '', '리스타트 결과가 아직 확정되지 않았습니다.',
    ].join('\n'))
    expect(text).not.toMatch(/\d위:/)
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
