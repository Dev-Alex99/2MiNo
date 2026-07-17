import { useEffect, useState } from 'react';

/**
 * Mismo umbral que las media queries del CSS.
 * Hace falta en JS (y no solo en CSS) porque en móvil el sidebar no se oculta:
 * directamente no se monta, y en su lugar van los asientos alrededor del tablero.
 */
const MOBILE_QUERY = '(max-width: 1024px)';

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches); // por si cambió entre el primer render y aquí
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
