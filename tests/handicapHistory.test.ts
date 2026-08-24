import { describe, it, expect, beforeEach } from 'vitest'
import { useApp } from '../src/store/appStore'
import type { Member } from '../src/types'

// 아래 이름·ID·핸디는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

/** 새 필드(prev/source/reason/byAdminId)가 생기기 전에 저장된 모양의 기존 이력. */
const legacyMember: Member = {
  id: 'm1',
  name: '테스트회원A',
  handicap: 20,
  handicapHistory: [
    { value: 18, changedAt: '2026-01-01T00:00:00.000Z' },
    { value: 20, changedAt: '2026-03-01T00:00:00.000Z' },
  ],
  active: true,
}

const memberOf = (id: string) => useApp.getState().members.find((m) => m.id === id)!
const lastEntry = (id: string) => {
  const h = memberOf(id).handicapHistory
  return h[h.length - 1]
}

beforeEach(() => {
  useApp.setState({
    members: [JSON.parse(JSON.stringify(legacyMember))],
    sessions: [], settings: { lastBackupAt: null }, ledger: [],
  })
})

describe('HandicapChange — 기존 데이터 하위호환', () => {
  it('새 필드가 없는 기존 이력도 그대로 읽히고 값이 바뀌지 않는다', () => {
    const h = memberOf('m1').handicapHistory
    expect(h).toHaveLength(2)
    expect(h[0]).toEqual({ value: 18, changedAt: '2026-01-01T00:00:00.000Z' })
    expect(h[0].prev).toBeUndefined()
    expect(h[0].source).toBeUndefined()
    expect(memberOf('m1').handicap).toBe(20)
  })

  it('기존 이력이 있는 회원의 핸디를 바꿔도 옛 이력 항목은 손대지 않는다', () => {
    useApp.getState().setHandicap('m1', 23)
    const h = memberOf('m1').handicapHistory
    expect(h).toHaveLength(3)
    expect(h[0]).toEqual({ value: 18, changedAt: '2026-01-01T00:00:00.000Z' })
    expect(h[1]).toEqual({ value: 20, changedAt: '2026-03-01T00:00:00.000Z' })
  })

  it('displayTag가 없는 기존 회원도 정상 동작한다', () => {
    expect(memberOf('m1').displayTag).toBeUndefined()
    useApp.getState().setHandicap('m1', 21)
    expect(memberOf('m1').displayTag).toBeUndefined()
    expect(memberOf('m1').handicap).toBe(21)
  })
})

describe('HandicapChange — 새 변경 이력 기록', () => {
  it('관리자가 핸디를 바꾸면 변경 전 값과 경로(admin)를 함께 남긴다', () => {
    useApp.getState().setHandicap('m1', 23)
    const e = lastEntry('m1')
    expect(e.value).toBe(23)
    expect(e.prev).toBe(20)
    expect(e.source).toBe('admin')
    expect(e.changedAt).toBeTruthy()
    // 신뢰할 수 있는 관리자 신원이 없으므로 byAdminId는 비워 둔다(PIN을 ID처럼 쓰지 않는다)
    expect(e.byAdminId).toBeUndefined()
  })

  it('새 회원을 추가하면 최초 지정이라 prev 없이 source만 남는다', () => {
    useApp.getState().addMember('테스트회원B', 15)
    const added = useApp.getState().members.find((m) => m.name === '테스트회원B')!
    expect(added.handicapHistory).toHaveLength(1)
    expect(added.handicapHistory[0].value).toBe(15)
    expect(added.handicapHistory[0].prev).toBeUndefined()
    expect(added.handicapHistory[0].source).toBe('admin')
  })

  it('핸디이력 CSV로 들어온 변경은 경로가 csv로 남고 앞 이력 값이 prev가 된다', () => {
    useApp.getState().applyHandicapCsv([{ name: '테스트회원A', date: '2026-06-01', handicap: 24 }])
    const e = lastEntry('m1')
    expect(e.value).toBe(24)
    expect(e.prev).toBe(20) // 2026-03-01 항목의 값
    expect(e.source).toBe('csv')
    expect(memberOf('m1').handicap).toBe(24)
  })

  it('회원명부 CSV로 기존 회원 핸디가 바뀌면 경로가 csv로 남는다', () => {
    useApp.getState().applyMemberCsv([{ name: '테스트회원A', handicap: 26 }])
    const e = lastEntry('m1')
    expect(e.value).toBe(26)
    expect(e.prev).toBe(20)
    expect(e.source).toBe('csv')
  })

  it('회원명부 CSV로 새로 추가된 회원은 최초 지정이라 prev가 없다', () => {
    useApp.getState().applyMemberCsv([{ name: '테스트회원C', handicap: 12 }])
    const added = useApp.getState().members.find((m) => m.name === '테스트회원C')!
    expect(added.handicapHistory[0].source).toBe('csv')
    expect(added.handicapHistory[0].prev).toBeUndefined()
  })
})
