import type { AppState, Member, Session } from '../types'
import { rate, winnerId } from '../logic/game'

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportJson(state: AppState, dateStr: string) {
  download(`billiards-backup-${dateStr}.json`, JSON.stringify(state, null, 2), 'application/json')
}

export function isAppState(v: unknown): v is AppState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.members) && Array.isArray(o.sessions) && typeof o.settings === 'object' && o.settings !== null
}

export async function importJson(file: File): Promise<AppState> {
  const text = await file.text()
  const parsed: unknown = JSON.parse(text)
  if (!isAppState(parsed)) throw new Error('올바른 백업 파일이 아닙니다.')
  return parsed
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const pct = (n: number) => (n * 100).toFixed(1) + '%'
const BOM = String.fromCharCode(0xfeff) // 구글 시트 한글 인코딩용

export function exportCsv(sessions: Session[], members: Member[], dateStr: string) {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id
  const header = ['날짜', '선수A', '핸디A', '득점A', '선수B', '핸디B', '득점B', '달성률A', '달성률B', '승자']
  const lines: string[] = [header.map(csvCell).join(',')]
  for (const s of sessions) {
    for (const g of s.games) {
      const win = winnerId(g)
      const cells: (string | number)[] = [
        s.date,
        name(g.playerAId),
        g.handicapA,
        g.scoreA,
        name(g.playerBId),
        g.handicapB,
        g.scoreB,
        pct(rate(g.scoreA, g.handicapA)),
        pct(rate(g.scoreB, g.handicapB)),
        win === null ? '무승부' : name(win),
      ]
      lines.push(cells.map(csvCell).join(','))
    }
  }
  download(`billiards-${dateStr}.csv`, BOM + lines.join('\n'), 'text/csv;charset=utf-8')
}


export function exportHandicapCsv(members: Member[], dateStr: string) {
  const header = ['이름', '날짜', '핸디']
  const lines: string[] = [header.map(csvCell).join(',')]
  for (const m of members) {
    const sorted = [...m.handicapHistory].sort((a, b) => a.changedAt.localeCompare(b.changedAt))
    for (const h of sorted) {
      lines.push([m.name, h.changedAt.slice(0, 10), h.value].map(csvCell).join(','))
    }
  }
  download(`billiards-handicap-${dateStr}.csv`, BOM + lines.join('\n'), 'text/csv;charset=utf-8')
}

export interface MemberRow {
  name: string
  handicap: number
  role?: string    // 직책
  dept?: string    // 학과
  year?: string    // 학번
  phone?: string   // 전화번호
}

export function exportMemberCsv(members: Member[], dateStr: string) {
  const header = ['이름', '에버리지', '직책', '학과', '학번', '전화번호']
  const lines: string[] = [header.map(csvCell).join(',')]
  for (const m of members) {
    lines.push([m.name, m.handicap, '', '', '', ''].map(csvCell).join(','))
  }
  download(`당신회_회원명부_${dateStr}.csv`, BOM + lines.join('\n'), 'text/csv;charset=utf-8')
}

export async function importMemberCsv(file: File): Promise<MemberRow[]> {
  const text = await file.text()
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('데이터가 없습니다.')

  // 헤더에서 컬럼 위치 찾기
  const headers = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const col = (names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h.includes(n))
      if (i >= 0) return i
    }
    return -1
  }
  const iName = col(['이름', '성  명', '성명', 'name'])
  const iHandi = col(['에버리지', '핸디', 'handicap', '에버'])
  const iRole = col(['직책'])
  const iDept = col(['학과'])
  const iYear = col(['학번'])
  const iPhone = col(['폰번호', '전화', 'phone'])

  if (iName < 0) throw new Error('이름 컬럼을 찾을 수 없습니다. (헤더: 이름 또는 성명)')

  const rows: MemberRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const name = iName >= 0 ? cols[iName] : ''
    if (!name) continue
    const handicapStr = iHandi >= 0 ? cols[iHandi] : '0'
    const handicap = parseInt(handicapStr, 10)
    rows.push({
      name,
      handicap: isNaN(handicap) ? 0 : handicap,
      role: iRole >= 0 ? cols[iRole] : undefined,
      dept: iDept >= 0 ? cols[iDept] : undefined,
      year: iYear >= 0 ? cols[iYear] : undefined,
      phone: iPhone >= 0 ? cols[iPhone] : undefined,
    })
  }
  if (rows.length === 0) throw new Error('유효한 회원 데이터가 없습니다.')
  return rows
}

export interface HandicapRow {
  name: string
  date: string
  handicap: number
}

export async function importHandicapCsv(file: File): Promise<HandicapRow[]> {
  const text = await file.text()
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('데이터가 없습니다.')
  const rows: HandicapRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const [name, date, handicapStr] = cols
    const handicap = parseInt(handicapStr, 10)
    if (!name || !date || isNaN(handicap)) throw new Error(`${i + 1}행 형식 오류: "${lines[i]}"`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${i + 1}행 날짜 형식 오류 (YYYY-MM-DD 필요): "${date}"`)
    rows.push({ name, date, handicap })
  }
  return rows
}
