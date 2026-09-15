import React from 'react';
import LineaTimbre from './LineaTimbre';
import LineaCapsula, { useHoja } from './LineaCapsula';
import HojaDeLinea from './HojaDeLinea';
import { useVoice } from './VoiceContext';

/**
 * LA SUPERFICIE GLOBAL DE LA LÍNEA: el único nodo de voz que monta el marco, y
 * el dueño EXCLUSIVO del timbre y de la hoja.
 *
 * Archivo creado por P3-MARCO y cedido a P6-LINEA (excepción documentada del
 * contrato §2a). El marco decide DÓNDE vive la voz —dentro del proveedor y por
 * encima de las seis vistas, así que ninguna navegación la desmonta—; QUÉ se
 * pinta ahí se decide aquí dentro, sin volver a tocar App.jsx.
 *
 * POR QUÉ «DUEÑO EXCLUSIVO» ES LA MITAD DEL PAQUETE. Hasta ahora la tarjeta de
 * llamada entrante se pintaba HASTA TRES VECES a la vez, con tres botones de
 * «Aceptar»: el widget tenía sus ramas de entrante y saliente por ENCIMA de sus
 * filtros por `variant`, y había tres instancias vivas a la vez (el flotante del
 * marco, la de `GameBar` y la del tablero de tres en raya). Ahora el timbre y la
 * hoja se montan aquí y sólo aquí; las superficies contextuales —la cápsula
 * anclada de `GameBar` y la de `WaitingRoom`— son SÓLO controles.
 *
 * `hayVozEmbebida`: la sala de espera y la partida montan su propia cápsula
 * anclada dentro de su barra, así que aquí no se pinta la libre. Sin esa guarda
 * saldrían dos barras de llamada a la vez. El timbre y la hoja NO se guardan:
 * son globales por definición, y precisamente dentro de la partida es donde más
 * falta hace que la llamada entrante tenga un solo dueño.
 */
export default function LineaGlobal({ hayVozEmbebida = false }) {
  // TODOS los hooks antes de cualquier `return`. Es la regresión A-4, que ya se
  // coló dos veces en este proyecto: un `return` condicional por encima de un
  // hook hace que el número de hooks cambie entre renders en cuanto la instancia
  // entra o sale del proveedor, y React revienta con «Rendered fewer hooks than
  // expected». Este componente se monta en las SEIS vistas.
  const voz = useVoice();
  const hojaAbierta = useHoja((s) => s.abierta);

  // Sin proveedor no hay motor al que pedirle nada. `useVoice()` puede devolver
  // null: los tableros y `CintaTurno` se renderizan sin él en sus tests.
  if (!voz) return null;

  return (
    <>
      <LineaTimbre />
      {!hayVozEmbebida && <LineaCapsula variante="libre" />}
      {hojaAbierta && <HojaDeLinea />}
    </>
  );
}
