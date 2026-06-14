import { describe, it, expect } from 'vitest'
import { rate, winnerId } from '../src/logic/game'
import type { Game } from '../src/types'

const base: Omit<Game, 'scoreA' | 'scoreB' | 'handicapA' | 'handicapB'> = {
  id: 'g1',
  playerAId: 'A',
  playerBId: 'B',
  endType: 'time',
  playedAt: '2026-06-14T10:00:00Z',
}

describe('rate', () => {
  it('점수/핸디 비율', () => {
    expect(rate(20, 25)).toBeCloseTo(0.8)
    expect(rate(15, 20)).toBeCloseTo(0.75)
  })
  it('핸디 0이면 0', () => {
    expect(rate(5, 0)).toBe(0)
  })
})

describe('winnerId', () => {
  it('달성률 높은 쪽 승 (A 80% vs B 75%)', () => {
    const g: Game = { ...base, handicapA: 25, handicapB: 20, scoreA: 20, scoreB: 15 }
    expect(winnerId(g)).toBe('A')
  })
  it('핸디 먼저 달성한 쪽 승 (A 25/25)', () => {
    const g: Game = { ...base, endType: 'cleared', handicapA: 25, handicapB: 20, scoreA: 25, scoreB: 18 }
    expect(winnerId(g)).toBe('A')
  })
  it('달성률 동일하면 무승부(null)', () => {
    const g: Game = { ...base, handicapA: 20, handicapB: 10, scoreA: 10, scoreB: 5 }
    expect(winnerId(g)).toBeNull()
  })
  it('명시적 winnerId가 있으면 점수와 무관하게 그것을 신뢰 (CSV 임포트)', () => {
    // 박상호 20점 vs 한석호 17점이지만 승자는 한석호 (핸디 달성률로 이김)
    const g: Game = { ...base, handicapA: 0, handicapB: 0, scoreA: 20, scoreB: 17, winnerId: 'B' }
    expect(winnerId(g)).toBe('B')
  })
})
