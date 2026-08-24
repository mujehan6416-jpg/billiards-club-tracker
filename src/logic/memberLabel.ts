import type { Member } from '../types'

/**
 * 회원을 화면에 보여줄 이름표를 만든다.
 *
 * 원칙:
 *  - 같은 이름이 한 명뿐이면 이름만 (기존과 동일).
 *  - 같은 이름이 둘 이상이면 구분정보를 괄호로 덧붙인다.
 *      1순위 displayTag (예: '홍길동 (90학번 · 경영)')
 *      2순위 현재 핸디 (displayTag가 없을 때 — 예: '홍길동 (핸디 20)')
 *      3순위 순번     (위 둘로도 같아질 때 — 예: '홍길동 (핸디 20 · 2)')
 *
 * 중요: 이 이름표는 사람이 읽기 위한 것일 뿐이고, 회원 식별은 언제나 Member.id로 한다.
 * 그래서 이름표가 끝내 똑같아지더라도 로그인·저장이 엉뚱한 회원에게 가지 않는다.
 */
export function buildMemberLabels(members: Member[]): Map<string, string> {
  const byName = new Map<string, Member[]>()
  for (const m of members) {
    const list = byName.get(m.name)
    if (list) list.push(m)
    else byName.set(m.name, [m])
  }

  const labels = new Map<string, string>()
  for (const [name, group] of byName) {
    if (group.length === 1) {
      labels.set(group[0].id, name)
      continue
    }
    // 동명이인 — id 순으로 정렬해 순번이 화면마다 흔들리지 않게 한다
    const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const suffixes = sorted.map((m) => (m.displayTag?.trim() ? m.displayTag.trim() : `핸디 ${m.handicap}`))
    const seen = new Map<string, number>()
    sorted.forEach((m, i) => {
      const base = suffixes[i]
      // 같은 구분정보가 또 있으면 순번을 붙여 반드시 서로 다르게 만든다
      const duplicated = suffixes.filter((s) => s === base).length > 1
      let suffix = base
      if (duplicated) {
        const n = (seen.get(base) ?? 0) + 1
        seen.set(base, n)
        suffix = `${base} · ${n}`
      }
      labels.set(m.id, `${name} (${suffix})`)
    })
  }
  return labels
}

/** 한 회원의 이름표만 필요할 때 쓰는 편의 함수. */
export function memberLabel(members: Member[], id: string): string {
  return buildMemberLabels(members).get(id) ?? members.find((m) => m.id === id)?.name ?? id
}
