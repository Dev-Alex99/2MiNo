import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, Headphones, Mic, MicOff, PhoneOff, Users, Video, VideoOff, Volume2, X
} from 'lucide-react';
import useModalA11y from '../hooks/useModalA11y';
import { useT } from '../i18n/LanguageContext';
import { useGameStore } from '../store/useGameStore';
import { useSocialStore } from '../social/useSocialStore';
import { useAgenda } from '../hub/CarrilDeGente';
import { colorDeJugador } from '../utils/colorDeJugador';
import { useLineaStore, acciones } from './useLineaStore';
import {
  BarrasDeCalidad, useHoja, useResumenDeLinea, useUltimoInterlocutor, peorPar
} from './LineaCapsula';
import { CON_MICRO, EN_LLAMADA } from './maquina';

/**
 * LA HOJA: todo lo que la cápsula no cabe.
 *
 * TRES BLOQUES, SIEMPRE EN EL MISMO ORDEN Y CON LA MISMA ALTURA MÍNIMA —TÚ,
 * LLAMADA, GENTE—. Esa constancia es la mitad del diseño: el jugador aprende
 * dónde mirar UNA vez. Un panel que reordena sus secciones según el estado
 * obliga a releerlo entero cada vez que cambia algo.
 *
 * En móvil es una hoja inferior que TAPA el tablero, no lo desplaza: si
 * participara del flujo, `.game-board-container` cambiaría de ancho,
 * `elegirPerRow` se recalcularía a media ronda y la serpiente se re-trazaría
 * sola delante del jugador. Cerrar devuelve la vista exacta.
 *
 * El medidor de 7 segmentos del bloque TÚ es el único elemento del diseño que
 * PRUEBA que tu micrófono funciona en lugar de afirmarlo — y su equivalente
 * hablado (`aria-description`, tres valores estables cada 2 s) hace lo mismo
 * para quien no lo ve.
 */

/** El texto del pie según el modo de retransmisión que anuncia /ice-config. */
const CLAVE_DE_RELEVO = {
  cloudflare: 'linea.relevoPropio',
  custom: 'linea.relevoPropio',
  'free-fallback': 'linea.relevoCortesia',
  none: 'linea.relevoNinguno'
};

/** Dónde se recuerda que ya se leyó el aviso de los filtros retirados. */
const CLAVE_FX = 'linea_fx_visto';

/** Segmentos del medidor de entrada. */
const SEGMENTOS = [0, 1, 2, 3, 4, 5, 6];

function leerFxVisto() {
  try { return localStorage.getItem(CLAVE_FX) === '1'; } catch { return false; }
}

/** Una fila de selector de aparato. Absorbe a `DeviceSelector`, SIN los seis
 *  «filtros de voz FX», que nunca tocaron un solo nodo de Web Audio. */
function FilaDeAparato({ icono, titulo, aparatos, valor, alCambiar, cambiando, porDefecto }) {
  if (!aparatos || aparatos.length === 0) return null;
  return (
    <label className="linea-aparato">
      <span className="linea-aparato-etiqueta">
        {icono}
        {titulo}
      </span>
      <select
        className="linea-aparato-select"
        value={valor || ''}
        // PROHIBIDO el atributo `disabled` (CONTRATO §10): saca al control del
        // orden de tabulación justo cuando hay algo que explicar. Se anuncia y
        // se rechaza en el manejador.
        aria-disabled={cambiando}
        onChange={(e) => { if (!cambiando) alCambiar(e.target.value); }}
      >
        {!valor && <option value="">{porDefecto}</option>}
        {aparatos.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${titulo} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function HojaDeLinea() {
  const { t } = useT();
  const cerrarHoja = useHoja((s) => s.cerrar);
  const resumen = useResumenDeLinea();
  const ultimo = useUltimoInterlocutor();

  const estado = useLineaStore((s) => s.estado);
  const motivo = useLineaStore((s) => s.motivo);
  const contexto = useLineaStore((s) => s.contexto);
  const miembros = useLineaStore((s) => s.miembros);
  const pares = useLineaStore((s) => s.pares);
  const paresRemotos = useLineaStore((s) => s.paresRemotos);
  const hablandoEnLinea = useLineaStore((s) => s.hablandoEnLinea);
  const vozDeMesa = useLineaStore((s) => s.vozDeMesa);
  const muted = useLineaStore((s) => s.muted);
  const isDeafened = useLineaStore((s) => s.isDeafened);
  const camOn = useLineaStore((s) => s.camOn);
  const camBusy = useLineaStore((s) => s.camBusy);
  const dispositivos = useLineaStore((s) => s.dispositivos);
  const seleccionados = useLineaStore((s) => s.seleccionados);
  const cambiando = useLineaStore((s) => s.cambiando);
  const micError = useLineaStore((s) => s.micError);
  const relevo = useLineaStore((s) => s.relevo);
  const avisos = useLineaStore((s) => s.avisos);
  const enOtraPestana = useLineaStore((s) => s.enOtraPestana);

  // El medidor se lee del store y NO del contexto: cambia hasta diez veces por
  // segundo y el proveedor envuelve la aplicación entera, así que por el
  // contexto repintaría la app en cada muestra. Aquí sólo se repinta la hoja.
  const nivel = useLineaStore((s) => s.nivel);
  const nivelPalabra = useLineaStore((s) => s.nivelPalabra);

  const cuentaId = useGameStore((s) => s.cuentaId);
  const roomId = useGameStore((s) => s.roomId);
  const gameState = useGameStore((s) => s.gameState);
  const { personas } = useAgenda();
  const amigos = useSocialStore((s) => s.amigos);
  const miCodigo = useSocialStore((s) => s.miCodigo);

  const [fxVisto, setFxVisto] = useState(leerFxVisto);
  const [verDesconectados, setVerDesconectados] = useState(false);

  const { propsPanel, propsTitulo } = useModalA11y(cerrarHoja);

  // Reloj de los ausentes. Sólo late mientras hay alguien reconectándose: el
  // estado de un par sólo cambia de identidad cuando cambia de verdad, así que
  // sin esto «Reconectando… N s» se quedaría clavado en el número de entrada.
  const [, tic] = useState(0);
  const desdeAusente = useRef(new Map());
  const hayAusente = Object.values(pares || {}).includes('ausente');
  useEffect(() => {
    if (!hayAusente) return undefined;
    const id = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [hayAusente]);

  const otros = useMemo(
    () => (miembros || []).filter((m) => m.playerId !== cuentaId),
    [miembros, cuentaId]
  );

  const hayLinea = EN_LLAMADA.includes(estado);
  const conMicro = CON_MICRO.includes(estado);
  const esMesa = !!contexto && contexto.tipo === 'mesa';
  const enUnaSala = !!roomId;
  const falloDeMicro = estado === 'cerrada' && String(motivo || '').startsWith('micro_');

  const segundosAusente = (id) => {
    const mapa = desdeAusente.current;
    if (pares[id] !== 'ausente') { mapa.delete(id); return 0; }
    if (!mapa.has(id)) mapa.set(id, Date.now());
    return Math.max(0, Math.round((Date.now() - mapa.get(id)) / 1000));
  };

  /** Mi mitad de la ruta y la del otro. La peor de las dos es la honesta: cada
   *  extremo sólo ve su lado, y decir «bien» cuando el otro no oye nada es la
   *  misma mentira de siempre en la otra dirección. */
  const estadoDePar = (id) => {
    const mio = pares[id];
    const suyo = paresRemotos[`${id}>${cuentaId}`];
    if (!suyo) return mio;
    return peorPar({ a: mio, b: suyo });
  };

  const descartarFx = () => {
    setFxVisto(true);
    try { localStorage.setItem(CLAVE_FX, '1'); } catch { /* almacenamiento bloqueado */ }
  };

  /**
   * TRAER A LA MESA. Tres pasos y tres trampas, en este orden:
   *
   * 1. Los acompañantes se guardan ANTES de nada: `miembros` es la única lista
   *    con sus ids de CUENTA y desaparece en cuanto salimos del pool privado.
   * 2. `cambiarALaMesa()` emite `end_call` y `join_table_voice` EN ESE ORDEN: el
   *    servidor responde `ya_en_linea` a un `join_table_voice` de quien sigue en
   *    un pool privado.
   * 3. Un `invitar()` por acompañante. `invite_to_pool` pasa por `puedeLlamar`,
   *    que tiene un enfriamiento de 20 s POR PAREJA: si la llamada empezó hace
   *    menos, el servidor contesta `call_error{enfriamiento}` — y eso ahora
   *    llega a la crónica en vez de perderse, así que el jugador se entera.
   */
  const traerALaMesa = () => {
    const acompanantes = otros.map((m) => m.playerId);
    acciones.cambiarALaMesa();
    for (const id of acompanantes) acciones.invitar(id);
  };

  const llamarA = (persona) => {
    if (hayLinea) acciones.invitar(persona.id);
    else acciones.llamar(persona.id, persona.username || '');
  };

  const desconectados = useMemo(() => (amigos || []).filter((a) => !a.online), [amigos]);
  const sentados = (gameState && gameState.players) || [];

  return (
    <div className="linea-velo" onClick={cerrarHoja}>
      <div
        className="linea-hoja"
        {...propsPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="linea-hoja-asa" aria-hidden="true" />

        <div className="linea-hoja-cabecera">
          <h2 className="linea-hoja-titulo" {...propsTitulo}>
            {resumen.texto || t('linea.entrarVoz')}
          </h2>
          <button
            type="button"
            className="linea-btn-icono"
            onClick={cerrarHoja}
            aria-label={t('common.close')}
          >
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </div>

        {enOtraPestana && (
          <p className="linea-nota">{t('linea.enOtraPestana')}</p>
        )}

        {/* ─────────────────────────────── TÚ ─────────────────────────────── */}
        <section className="linea-bloque linea-bloque-tu" aria-label={t('voice.you')}>
          <h3 className="linea-bloque-titulo">{t('voice.you')}</h3>

          <div className="linea-tu-fila">
            <button
              type="button"
              className={`linea-btn-icono linea-btn-micro ${muted ? 'activo' : ''}`}
              onClick={acciones.alternarSilencio}
              aria-pressed={muted}
              aria-label={muted ? t('voice.unmute') : t('voice.mute')}
              // El medidor visual no sirve a un lector: la descripción dice el
              // nivel en TRES valores estables, recalculados como mucho cada 2 s.
              // Un medidor que se anuncie sesenta veces por segundo es peor que
              // ninguno.
              aria-description={t(nivelPalabra)}
              title={t('linea.atajoSilenciar')}
            >
              {muted ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
            </button>

            <span className="linea-nivel" aria-hidden="true">
              {SEGMENTOS.map((i) => (
                <i key={i} className={i < nivel ? 'viva' : ''} />
              ))}
            </span>

            <button
              type="button"
              className={`linea-btn-icono ${isDeafened ? 'activo' : ''}`}
              onClick={acciones.alternarEnsordecido}
              aria-pressed={isDeafened}
              aria-label={isDeafened ? t('voice.undeafen') : t('voice.deafen')}
            >
              <Headphones size={20} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`linea-btn-icono ${camOn ? 'activo' : ''}`}
              onClick={() => { if (!camBusy) acciones.alternarCamara(); }}
              aria-disabled={camBusy}
              aria-pressed={camOn}
              aria-label={camOn ? t('voice.camOff') : t('voice.camOn')}
            >
              {camOn ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />}
            </button>
          </div>

          <FilaDeAparato
            icono={<Mic size={12} aria-hidden="true" />}
            titulo={t('dev.mic')}
            aparatos={dispositivos.mics}
            valor={seleccionados.mic}
            alCambiar={acciones.elegirMicro}
            cambiando={cambiando}
            porDefecto={t('dev.default')}
          />
          <FilaDeAparato
            icono={<Video size={12} aria-hidden="true" />}
            titulo={t('dev.cam')}
            aparatos={dispositivos.cams}
            valor={seleccionados.cam}
            alCambiar={acciones.elegirCamara}
            cambiando={cambiando}
            porDefecto={t('dev.default')}
          />
          {acciones.canPickSpeaker && (
            <FilaDeAparato
              icono={<Volume2 size={12} aria-hidden="true" />}
              titulo={t('dev.speaker')}
              aparatos={dispositivos.speakers}
              valor={seleccionados.speaker}
              alCambiar={acciones.elegirAltavoz}
              cambiando={cambiando}
              porDefecto={t('dev.default')}
            />
          )}

          {/* Las dos notas del selector viejo, que seguían traducidas en los
              tres idiomas y se quedaban huérfanas al absorber `DeviceSelector`.
              La de la cámara importa más de lo que parece: sin ella, un aparato
              listado y apagado se lee como un aparato roto. */}
          {dispositivos.cams.length > 0 && !camOn && (
            <span className="linea-pista">{t('dev.camHint')}</span>
          )}
          {dispositivos.mics.length <= 1 && dispositivos.cams.length <= 1
            && dispositivos.speakers.length <= 1 && (
            <span className="linea-pista">{t('dev.onlyOne')}</span>
          )}

          {/* El fallo de micrófono ABORTA la llamada y aquí trae su salida. El
              modo «solo escucha» existe ÚNICAMENTE detrás de este botón: como
              consecuencia silenciosa de un fallo sería la versión educada del
              bug de siempre —el teléfono del otro suena, contesta, y descubre
              que no puedes hablarle—. */}
          {micError && (
            <div className="linea-error" role="group" aria-label={t(micError.clave)}>
              <span className="linea-error-texto">{t(micError.clave)}</span>
              {falloDeMicro && (
                <div className="linea-error-salidas">
                  <button type="button" className="linea-btn" onClick={acciones.soloEscuchar}>
                    {t('linea.soloEscuchar')}
                  </button>
                  {ultimo && ultimo.id && (
                    <button
                      type="button"
                      className="linea-btn"
                      onClick={() => acciones.llamar(ultimo.id, ultimo.nombre)}
                    >
                      {t('linea.volverALlamar')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ────────────────────────────── LLAMADA ─────────────────────────── */}
        <section className="linea-bloque linea-bloque-llamada" aria-label={t('voice.callTitle')}>
          <h3 className="linea-bloque-titulo">{t('voice.callTitle')}</h3>

          {otros.length === 0 && (
            <p className="linea-vacio">
              {hayLinea ? t('voice.nobody') : t('linea.colgada')}
            </p>
          )}

          {otros.map((m) => (
            <div
              key={m.playerId}
              className={`linea-fila ${hablandoEnLinea[m.playerId] ? 'linea-fila-habla' : ''}`}
            >
              <span
                className="linea-fila-avatar"
                aria-hidden="true"
                style={{
                  background: `color-mix(in srgb, ${colorDeJugador(m.playerId)} 20%, var(--sup-2))`,
                  borderColor: colorDeJugador(m.playerId)
                }}
              >
                {(m.name || '?').charAt(0).toUpperCase()}
              </span>
              <span className="linea-fila-nombre">{m.name}</span>
              <BarrasDeCalidad
                estado={estadoDePar(m.playerId)}
                conPalabra
                segundosAusente={segundosAusente(m.playerId)}
              />
            </div>
          ))}

          {/* Sin ruta: el fallo ESPERADO cuando no hay retransmisión, con sus
              tres salidas. El `pc` no se ha cerrado y sigue intentándolo por
              detrás: si conecta tarde, esta tarjeta se va sola. */}
          {estado === 'sinRuta' && (
            <div className="linea-sinruta">
              <strong>{t('linea.sinRutaTitulo')}</strong>
              <span>{t('linea.sinRutaDetalle')}</span>
              <div className="linea-sinruta-salidas">
                <button type="button" className="linea-btn" onClick={acciones.reintentar}>
                  {t('linea.reintentar')}
                </button>
                {enUnaSala && (
                  <button type="button" className="linea-btn" onClick={cerrarHoja}>
                    {t('linea.sinRutaUsarChat')}
                  </button>
                )}
              </div>
              <span className="linea-pista">{t('linea.sinRutaProbadWifi')}</span>
              <span className="linea-pista">{t('linea.sinRutaProbadDatos')}</span>
            </div>
          )}

          {/* PERSISTENTE Y SIN TEMPORIZADOR. Una decisión con caducidad de ocho
              segundos sobre a quién dejas de oír no es una elección, es una
              trampa. No hay tercera opción porque no hacer nada ES el
              comportamiento por defecto. */}
          {hayLinea && !esMesa && enUnaSala && (
            <div className="linea-mesa-fila">
              <span className="linea-mesa-texto">
                {t('linea.sigesEnLineaCon', { name: (otros[0] || {}).name || '' })}
              </span>
              <div className="linea-mesa-acciones">
                {otros.length > 0 && (
                  <button type="button" className="linea-btn" onClick={traerALaMesa}>
                    {t('linea.traerALaMesa')}
                  </button>
                )}
                <button type="button" className="linea-btn" onClick={acciones.cambiarALaMesa}>
                  {t('linea.cambiarALaMesa')}
                </button>
              </div>
            </div>
          )}

          <div className="linea-llamada-acciones">
            {!hayLinea && enUnaSala && (
              <button type="button" className="linea-btn linea-btn-primario" onClick={acciones.entrarAMesa}>
                {vozDeMesa.n > 0 ? t('linea.entrarVozN', { n: vozDeMesa.n }) : t('linea.entrarVoz')}
              </button>
            )}
            {conMicro && (
              <button type="button" className="linea-btn linea-btn-colgar" onClick={acciones.colgar}>
                <PhoneOff size={16} aria-hidden="true" />
                {t('linea.colgar')}
              </button>
            )}
          </div>

          {/* La crónica de la línea. Dentro de la partida la drena GameView en
              su `role="log"` (CONTRATO §7: cero regiones vivas nuevas); aquí se
              puede releer y descartar una a una. */}
          {avisos.length > 0 && (
            <ul className="linea-cronica">
              {avisos.map((a) => (
                <li key={a.id}>
                  <span>{t(a.key, a.params || undefined)}</span>
                  <button
                    type="button"
                    className="linea-btn-icono linea-btn-mini"
                    onClick={() => acciones.descartarAviso(a.id)}
                    aria-label={t('common.close')}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─────────────────────────────── GENTE ──────────────────────────── */}
        <section className="linea-bloque linea-bloque-gente" aria-label={t('hub.gente')}>
          <h3 className="linea-bloque-titulo">{t('hub.gente')}</h3>

          {enUnaSala && sentados.length > 0 && (
            <>
              <h4 className="linea-sub">{t('linea.enEstaMesa')}</h4>
              <ul className="linea-lista">
                {sentados.map((p) => (
                  <li key={p.id} className="linea-fila linea-fila-mesa">
                    <span
                      className="linea-fila-avatar"
                      aria-hidden="true"
                      style={{
                        background: `color-mix(in srgb, ${colorDeJugador(p.id)} 20%, var(--sup-2))`,
                        borderColor: colorDeJugador(p.id)
                      }}
                    >
                      {(p.name || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="linea-fila-nombre">{p.name}</span>
                    {(vozDeMesa.alias || []).includes(p.id) && (
                      <Mic size={14} className="linea-fila-micro" aria-label={t('linea.entrarVoz')} />
                    )}
                  </li>
                ))}
              </ul>
              {/* NO HAY BOTÓN DE «LLAMAR A ESTA PERSONA» AQUÍ, y no es un olvido:
                  dentro de una sala `player.id` es el ALIAS de asiento (`s_xxxx`),
                  no el id de cuenta que necesita `call_friend`. El puente
                  alias→cuenta vive sólo en el servidor y a propósito (hubo
                  cosecha real de identidades espectando partidas públicas). A la
                  mesa se la llama entera, que además es lo que no timbra a
                  nadie. */}
              {!hayLinea && (
                <button type="button" className="linea-btn" onClick={acciones.entrarAMesa}>
                  {t('linea.llamarMesa')}
                </button>
              )}
            </>
          )}

          <h4 className="linea-sub">{t('linea.amigosEnLinea')}</h4>
          {personas.length === 0 && <p className="linea-vacio">{t('hub.nadieEnLinea')}</p>}
          <ul className="linea-lista">
            {personas.map((persona) => (
              <li key={persona.id} className="linea-fila">
                <span
                  className="linea-fila-avatar"
                  aria-hidden="true"
                  style={{
                    background: `color-mix(in srgb, ${colorDeJugador(persona.id)} 20%, var(--sup-2))`,
                    borderColor: colorDeJugador(persona.id)
                  }}
                >
                  {(persona.username || '?').charAt(0).toUpperCase()}
                </span>
                <span className="linea-fila-nombre">{persona.username}</span>
                <button
                  type="button"
                  className="linea-btn linea-btn-mini"
                  aria-disabled={persona.estado === 'no_molestar'}
                  onClick={() => { if (persona.estado !== 'no_molestar') llamarA(persona); }}
                >
                  {persona.estado === 'no_molestar'
                    ? t('hub.noMolestaA', { name: persona.username })
                    : (hayLinea
                      ? t('linea.anadirALaLinea')
                      : t('hub.llamarA', { name: persona.username }))}
                </button>
              </li>
            ))}
          </ul>

          {desconectados.length > 0 && (
            <>
              <button
                type="button"
                className="linea-plegable"
                aria-expanded={verDesconectados}
                onClick={() => setVerDesconectados((v) => !v)}
              >
                <Users size={14} aria-hidden="true" />
                {t('linea.desconectados')} ({desconectados.length})
              </button>
              {verDesconectados && (
                <ul className="linea-lista linea-lista-apagada">
                  {desconectados.map((a) => (
                    <li key={a.id} className="linea-fila">
                      <span className="linea-fila-nombre">{a.username}</span>
                      <span className="linea-fila-estado">{t('pres.desconectado')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* El código sólo se enseña si de verdad lo tenemos. La versión
              anterior pintaba «·····» eterno y su botón de copiar anunciaba
              «¡Copiado!» habiendo copiado la cadena vacía. */}
          {miCodigo && (
            <p className="linea-codigo">
              {t('hub.compartirCodigo')}: <b>{miCodigo}</b>
            </p>
          )}
        </section>

        {/* ──────────────────────────────── PIE ───────────────────────────── */}
        <footer className="linea-pie">
          {/* LA LÍNEA DE LA VERDAD, PERMANENTE Y NO SÓLO EN EL FALLO. Quien lee
              esto ANTES de llamar interpreta un fallo de NAT como una limitación
              conocida; quien no lo lee interpreta el mismo fallo como un
              producto roto. Mismo hecho, dos productos. Ramifica por `turnMode`
              (cadena) y NUNCA por `turnConfigured`: el servidor pone
              turnMode='free-fallback' con tres URLs de openrelay reales
              mientras el booleano sigue en false. */}
          <span className="linea-verdad">{t(CLAVE_DE_RELEVO[relevo] || 'linea.relevoNinguno')}</span>

          {!fxVisto && (
            <span className="linea-fx">
              {t('linea.fxRetirados')}
              <button
                type="button"
                className="linea-btn-icono linea-btn-mini"
                onClick={descartarFx}
                aria-label={t('common.close')}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
