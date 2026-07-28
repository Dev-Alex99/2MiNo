import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import UnifiedVoiceWidget from './UnifiedVoiceWidget';
import { VoiceProvider } from '../voice/VoiceContext';
import { render, resetStores } from '../test/utils';

/**
 * Regresión A-4.
 *
 * El widget tenía `if (!voice) return null` POR ENCIMA de tres `useState` y un
 * `useEffect`. Es la misma clase de fallo que C-4 (que ya había roto la app al
 * entrar en modo espectador), reintroducida: en cuanto una instancia montada
 * pasa de estar fuera del provider a estar dentro, el número de hooks cambia
 * entre renders y React revienta con "Rendered fewer hooks than expected".
 *
 * El widget se monta en cuatro sitios distintos (tablero, sala de espera, tres
 * en raya y el flotante de App), así que la situación es alcanzable de verdad.
 */
describe('UnifiedVoiceWidget · orden de hooks', () => {
  beforeEach(() => resetStores());

  it('fuera del proveedor de voz no pinta nada, sin romper', () => {
    const { container } = render(<UnifiedVoiceWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dentro del proveedor se monta y pinta el estado en reposo', () => {
    // `embedded` es la variante que muestra el panel aunque no haya llamada; la
    // `floating` devuelve null a propósito mientras no hay nadie conectado.
    const { container } = render(
      <VoiceProvider roomId="ABCD" playerId="p_test" name="Yo">
        <UnifiedVoiceWidget variant="embedded" />
      </VoiceProvider>
    );
    expect(container).not.toBeEmptyDOMElement();
  });

  it('pasar de FUERA a DENTRO del proveedor no rompe el orden de hooks', () => {
    // La misma posición del árbol: React conserva la instancia y sólo cambia el
    // valor del contexto. Con el early-return por encima de los hooks, este
    // rerender lanzaba "Rendered fewer hooks than expected".
    function Envoltorio({ conProveedor }) {
      const widget = <UnifiedVoiceWidget variant="floating" />;
      return conProveedor
        ? <VoiceProvider roomId="ABCD" playerId="p_test" name="Yo">{widget}</VoiceProvider>
        : widget;
    }

    const { rerender } = render(<Envoltorio conProveedor={false} />);
    expect(() => rerender(<Envoltorio conProveedor />)).not.toThrow();
    expect(() => rerender(<Envoltorio conProveedor={false} />)).not.toThrow();
  });
});
