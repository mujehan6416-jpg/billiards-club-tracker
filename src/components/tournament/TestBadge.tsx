/** 테스트 대회 표시 — 실제 대회와 헷갈리지 않게 이름 옆에 붙는 작은 배지. */
export function TestBadge() {
  return (
    <span
      data-testid="test-badge"
      style={{
        marginLeft: 8, fontSize: 13, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
        background: '#fff3cd', color: '#7a5200', whiteSpace: 'nowrap', verticalAlign: 'middle',
      }}
    >
      테스트
    </span>
  )
}
