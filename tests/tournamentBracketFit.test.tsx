import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  BRACKET_LAYOUT, calculateBracketLayout, fitBracketGeometry, MIN_FIT_CARD_WIDTH,
} from '../src/logic/tournamentBracketLayout'
import { TournamentBracketVisual } from '../src/components/tournament/TournamentBracketVisual'
import { fullMain } from './fixtures/restartMain'

// "전체 대진표"에서 마지막 열(결승)이 폰 화면 밖으로 밀려 잘리던 문제 — 모든 라운드 열이 한 화면에 들어오는지 확인한다.
// 가상 데이터만 사용한다.

const nameOf = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')

describe('fitBracketGeometry — 라운드 열을 화면 폭에 맞춘다', () => {
  it('기본 크기로 이미 들어가면 건드리지 않는다(null = 기본 레이아웃)', () => {
    expect(fitBracketGeometry(3, 548)).toBeNull()
    expect(fitBracketGeometry(3, 900)).toBeNull()
    expect(fitBracketGeometry(2, 344)).toBeNull()
  })

  it('폭을 알 수 없으면(0) 건드리지 않는다', () => {
    expect(fitBracketGeometry(3, 0)).toBeNull()
  })

  it('폰 폭(362px): 3라운드(8강·4강·결승)는 열 전체가 들어가고 글자는 17px 그대로다', () => {
    const g = fitBracketGeometry(3, 362)!
    expect(g).toEqual({ cardWidth: 107, columnGap: 20, nameFontSize: 17 })
    expect(3 * g.cardWidth + 2 * g.columnGap).toBeLessThanOrEqual(362)
  })

  it('iPad 세로 폭(약 452px)에서도 3라운드가 모두 들어간다', () => {
    const g = fitBracketGeometry(3, 452)!
    expect(3 * g.cardWidth + 2 * g.columnGap).toBeLessThanOrEqual(452)
    expect(g.nameFontSize).toBe(17)
  })

  it('4라운드(16강~결승)도 폰 폭에 들어가며 글자는 조금만(14px) 줄인다', () => {
    const g = fitBracketGeometry(4, 362)!
    expect(g.cardWidth).toBeGreaterThanOrEqual(MIN_FIT_CARD_WIDTH)
    expect(4 * g.cardWidth + 3 * g.columnGap).toBeLessThanOrEqual(362)
    expect(g.nameFontSize).toBe(14)
  })

  it('5라운드 이상(32강 등)은 카드가 너무 좁아져 이름이 잘리므로 줄이지 않고 기존 가로 스크롤을 유지한다', () => {
    expect(fitBracketGeometry(5, 362)).toBeNull()
  })
})

describe('calculateBracketLayout — 줄인 폭이 열 위치에 그대로 반영된다', () => {
  const matches = fullMain(8)

  it('geometry를 주지 않으면 기존 좌표와 완전히 같다(회귀 없음)', () => {
    const base = calculateBracketLayout(matches)
    const xs = [...new Set([...base.values()].map((p) => p.x))].sort((a, b) => a - b)
    expect(xs).toEqual([0, 204, 408]) // CARD_WIDTH 140 + COLUMN_GAP 64
    expect(calculateBracketLayout(matches, null)).toEqual(base)
  })

  it('geometry를 주면 열 간격이 카드 폭 + 열 간격으로 바뀌고, 세로 위치(centerY)는 그대로다', () => {
    const base = calculateBracketLayout(matches)
    const fit = calculateBracketLayout(matches, { cardWidth: 107, columnGap: 20 })
    const xs = [...new Set([...fit.values()].map((p) => p.x))].sort((a, b) => a - b)
    expect(xs).toEqual([0, 127, 254])
    for (const [id, pos] of base) expect(fit.get(id)!.centerY).toBe(pos.centerY)
  })
})

describe('TournamentBracketVisual — 폰 폭에서 8강·4강·결승 머리글이 모두 화면 안에 보인다', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const setWidth = (w: number) => Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
  })

  const headerBoxes = () => ['8강', '4강', '결승'].map((label) => {
    const el = screen.getByText(label)
    return { label, left: parseFloat(el.style.left), width: parseFloat(el.style.width) }
  })

  it('화면 폭 362px: 모든 열이 폭 안에 들어오고(결승 머리글 오른쪽 끝 ≤ 362), 카드 폭이 같이 줄어든다', () => {
    setWidth(362)
    const { container } = render(<TournamentBracketVisual matches={fullMain(8)} nameOf={nameOf} />)
    for (const b of headerBoxes()) expect(b.left + b.width).toBeLessThanOrEqual(362)
    const card = container.querySelector('[data-match-id]') as HTMLElement
    expect(parseFloat(card.style.width)).toBeLessThan(BRACKET_LAYOUT.CARD_WIDTH)
    // 전체 폭도 화면 폭을 넘지 않는다 → 가로 스크롤이 필요 없다
    const content = container.querySelector('svg')!.parentElement as HTMLElement
    expect(parseFloat(content.style.width)).toBeLessThanOrEqual(362)
  })

  it('넓은 화면(폭 900px)에서는 기본 크기 그대로다', () => {
    setWidth(900)
    const { container } = render(<TournamentBracketVisual matches={fullMain(8)} nameOf={nameOf} />)
    const card = container.querySelector('[data-match-id]') as HTMLElement
    expect(parseFloat(card.style.width)).toBe(BRACKET_LAYOUT.CARD_WIDTH)
  })

  it('폭을 알 수 없는 환경에서도(기본 0) 기존 모양 그대로다', () => {
    const { container } = render(<TournamentBracketVisual matches={fullMain(8)} nameOf={nameOf} />)
    const card = container.querySelector('[data-match-id]') as HTMLElement
    expect(parseFloat(card.style.width)).toBe(BRACKET_LAYOUT.CARD_WIDTH)
  })

  it('32강처럼 카드가 너무 좁아지는 큰 대진은 줄이지 않고 기존 가로 스크롤을 그대로 쓴다', () => {
    setWidth(362)
    const { container } = render(<TournamentBracketVisual matches={fullMain(32)} nameOf={nameOf} />)
    const card = container.querySelector('[data-match-id]') as HTMLElement
    expect(parseFloat(card.style.width)).toBe(BRACKET_LAYOUT.CARD_WIDTH)
  })
})
