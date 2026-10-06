// 요소가 화면에 보이도록 부드럽게 스크롤한다. 단순 window.scrollTo(0, 0) 대신 "그 요소 기준"으로 움직여서
// 위쪽에 다른 카드가 몇 개 있든 원하는 위치로 간다.
// - 테스트 환경(jsdom)처럼 scrollIntoView가 없는 곳에서는 아무 일도 하지 않는다(오류를 내지 않는다).
// - 기기에서 "동작 줄이기"를 켜 둔 경우에는 부드러운 이동 대신 바로 이동한다.
export function scrollToElement(el: Element | null | undefined, block: ScrollLogicalPosition = 'start'): void {
  if (!el || typeof el.scrollIntoView !== 'function') return
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block })
}
