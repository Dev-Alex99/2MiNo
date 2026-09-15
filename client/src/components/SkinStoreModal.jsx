import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShoppingBag, Check, Coins, X, ShieldCheck, Sparkles, Lock, Palette } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { playGameSound } from '../audio';
import { applyTable, applySkin, TABLES, SKINS } from '../theme';
import useModalA11y from '../hooks/useModalA11y';
import { useSocialStore, iniciarSocial, useCapacidades, hayPersistencia } from '../social/useSocialStore';

/* ───────── Catálogo de fichas (tile) ─────────
   Sólo id, precio y aspecto. El nombre y la descripción los pone t() con
   `store.<id>.n` y `store.<id>.d`, que existen en los tres idiomas: los campos
   `name` y `desc` que había aquí duplicaban 19 cadenas en español duro que ya
   estaban traducidas y que NADIE leía (la tarjeta siempre pintó las claves). */

const TILE_CATALOG = [
  { id: 'classic',       cost: 0,    icon: '🀌', bg: 'linear-gradient(135deg, #fef3c7, #d97706)' },
  { id: 'cyberpunk',     cost: 200,  icon: '⚡', bg: 'linear-gradient(135deg, #06b6d4, #ec4899)' },
  { id: 'obsidian',      cost: 400,  icon: '💎', bg: 'linear-gradient(135deg, #1e1b4b, #6366f1)' },
  { id: 'walnut',        cost: 350,  icon: '🪵', bg: 'linear-gradient(135deg, #78350f, #b45309)' },
  { id: 'rose_gold',     cost: 750,  icon: '👑', bg: 'linear-gradient(135deg, #f43f5e, #fbbf24)' },
  { id: 'midnight',      cost: 300,  icon: '🌙', bg: 'linear-gradient(135deg, #0c4a6e, #1e3a5f)' },
  { id: 'volcanic',      cost: 500,  icon: '🌋', bg: 'linear-gradient(135deg, #7f1d1d, #ef4444)' },
  { id: 'arctic',        cost: 450,  icon: '❄️', bg: 'linear-gradient(135deg, #cffafe, #22d3ee)' },
  { id: 'jade',          cost: 600,  icon: '🟢', bg: 'linear-gradient(135deg, #064e3b, #34d399)' },
  { id: 'golden_dragon', cost: 1000, icon: '🐉', bg: 'linear-gradient(135deg, #78350f, #fbbf24)' },
];

/* ───────── Catálogo de tapetes (board) ───────── */

const BOARD_CATALOG = [
  { id: 'emerald',      cost: 0,   icon: '🌿', bg: 'linear-gradient(135deg, #064e3b, #047857)' },
  { id: 'dark_oak',     cost: 250, icon: '🪵', bg: 'linear-gradient(135deg, #292524, #44403c)' },
  { id: 'neon_galaxy',  cost: 450, icon: '🌌', bg: 'linear-gradient(135deg, #0f172a, #3b82f6)' },
  { id: 'mayan_temple', cost: 600, icon: '🏛️', bg: 'linear-gradient(135deg, #451a03, #d97706)' },
  { id: 'ocean_deep',   cost: 350, icon: '🌊', bg: 'linear-gradient(135deg, #0c4a6e, #0ea5e9)' },
  { id: 'blood_moon',   cost: 500, icon: '🩸', bg: 'linear-gradient(135deg, #450a0a, #dc2626)' },
  { id: 'zen_garden',   cost: 400, icon: '🎍', bg: 'linear-gradient(135deg, #d6d3d1, #78716c)' },
  { id: 'cyber_grid',   cost: 550, icon: '🔮', bg: 'linear-gradient(135deg, #1e1b4b, #a855f7)' },
];

/* ───────── Mini-preview de ficha ───────── */

function TilePreview({ skinId }) {
  const skin = SKINS.find(s => s.id === skinId);
  if (!skin) return null;
  return (
    <span style={{
      display: 'inline-flex', gap: 2, padding: '3px 5px', borderRadius: 4,
      background: skin.bg, border: '1px solid rgba(255,255,255,0.15)'
    }}>
      {[0,1,2,3].map(i => (
        <i key={i} style={{
          width: 4, height: 4, borderRadius: '50%',
          background: skin.pip, display: 'block'
        }} />
      ))}
    </span>
  );
}

/* ───────── Mini-preview de tapete ───────── */

function BoardPreview({ tableId }) {
  const table = TABLES.find(t => t.id === tableId);
  if (!table) return null;
  return (
    <span style={{
      display: 'inline-block', width: 28, height: 20, borderRadius: 4,
      background: table.bg, border: '1px solid rgba(255,255,255,0.15)'
    }} />
  );
}

/* ─────────────────── Componente principal ─────────────────── */

/**
 * La tienda. En modo degradado deja de ser un muro de candados y pasa a
 * ESCAPARATE: se ve el catálogo entero, se puede navegar y probar lo gratuito,
 * y se dice por qué no se puede comprar. Antes arrancaba en 0 monedas sobre el
 * mismo monedero del que el perfil afirmaba 500, y lo pintaba todo bloqueado
 * como si el jugador simplemente fuese pobre.
 */
export default function SkinStoreModal({ playerId, name, onClose }) {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState('tile');
  const [equippedTile, setEquippedTile] = useState('classic');
  const [equippedBoard, setEquippedBoard] = useState('emerald');
  const [ownedSkins, setOwnedSkins] = useState(new Set(['classic', 'emerald']));
  const [purchasing, setPurchasing] = useState(null);
  const [message, setMessage] = useState(null);
  const messageTimerRef = useRef(null);

  // El monedero y el estado de carga vienen del store social: son el MISMO dato
  // que lee el perfil, y ahí está el vigilante de 6 s que aquí no existía.
  // `perfil.coins` a null significa «no lo sabemos», nunca «cero».
  const perfil = useSocialStore((s) => s.perfil);
  const estado = useSocialStore((s) => s.estado);
  const recargar = useSocialStore((s) => s.recargar);
  const conCompras = hayPersistencia(useCapacidades());
  const userCoins = perfil?.coins != null ? perfil.coins : null;

  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  const showMessage = useCallback((text, type = 'success') => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage({ text, type });
    messageTimerRef.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  // El inventario que llega con el perfil. La suscripción a `profile_data` ya
  // no es de aquí: la lleva el store social, que sigue escuchando con la tienda
  // cerrada y trae el vigilante que a esta pantalla le faltaba.
  useEffect(() => {
    iniciarSocial();
    if (!perfil) return;
    if (perfil.equipped_tile_skin) {
      setEquippedTile(perfil.equipped_tile_skin);
      applySkin(perfil.equipped_tile_skin);
    }
    if (perfil.equipped_board_theme) {
      setEquippedBoard(perfil.equipped_board_theme);
      applyTable(perfil.equipped_board_theme);
    }

    const owned = new Set(['classic', 'emerald']);
    if (perfil.equipped_tile_skin) owned.add(perfil.equipped_tile_skin);
    if (perfil.equipped_board_theme) owned.add(perfil.equipped_board_theme);
    if (Array.isArray(perfil.ownedSkins)) perfil.ownedSkins.forEach(s => owned.add(s));
    setOwnedSkins(owned);
  }, [perfil]);

  useEffect(() => {
    function onSkinEquipped(res) {
      setPurchasing(null);
      if (!res) return;
      if (res.success && res.user) {
        // El monedero lo lleva el store: se vuelve a pedir el perfil para que
        // la tienda y el perfil no puedan discrepar sobre las mismas monedas.
        recargar();

        const newTile = res.user.equipped_tile_skin || 'classic';
        const newBoard = res.user.equipped_board_theme || 'emerald';
        setEquippedTile(newTile);
        setEquippedBoard(newBoard);

        // Aplicar CSS en vivo inmediatamente
        applySkin(newTile);
        applyTable(newBoard);

        const owned = new Set(['classic', 'emerald']);
        if (newTile) owned.add(newTile);
        if (newBoard) owned.add(newBoard);
        if (Array.isArray(res.user.ownedSkins)) {
          res.user.ownedSkins.forEach(s => owned.add(s));
        }
        setOwnedSkins(owned);

        if (res.purchased) {
          playGameSound('win_round');
          showMessage(t('store.boughtMsg'), 'success');
        } else {
          showMessage(t('store.equippedMsg'), 'success');
        }
      } else {
        // res.error es una clave i18n (p. ej. 'store.insufficient').
        showMessage(res.error ? t(res.error) : t('store.errorMsg'), 'error');
      }
    }

    socket.on('skin_equipped', onSkinEquipped);
    return () => socket.off('skin_equipped', onSkinEquipped);
  }, [showMessage, recargar, t]);

  const items = activeTab === 'tile' ? TILE_CATALOG : BOARD_CATALOG;

  const handleAction = useCallback((item) => {
    const isEquipped = activeTab === 'tile'
      ? equippedTile === item.id
      : equippedBoard === item.id;
    if (isEquipped || purchasing) return;

    const isOwned = ownedSkins.has(item.id) || item.cost === 0;

    // En un servidor sin persistencia lo gratuito SÍ se puede equipar (se
    // aplica en vivo con applySkin/applyTable, sin pasar por la base de datos);
    // lo que no se puede es comprar, y el motivo está en la franja de arriba.
    if (!isOwned && !conCompras) return;

    // Sin persistencia el servidor no va a contestar `skin_equipped`, así que
    // se aplica aquí mismo: el escaparate se puede probar aunque no se pueda
    // comprar. No se guarda nada y eso ya lo dice la franja.
    if (!conCompras) {
      if (activeTab === 'tile') { setEquippedTile(item.id); applySkin(item.id); }
      else { setEquippedBoard(item.id); applyTable(item.id); }
      showMessage(t('store.equippedMsg'), 'success');
      return;
    }

    // Chequeo de solvencia solo para UX; el precio real y el cobro los valida el servidor.
    if (!isOwned && userCoins != null && userCoins < item.cost) {
      showMessage(t('store.insufficient'), 'error');
      return;
    }

    setPurchasing(item.id);
    socket.emit('equip_skin', {
      playerId,
      username: name || 'Jugador',
      category: activeTab,
      itemId: item.id
    });
  }, [activeTab, equippedTile, equippedBoard, ownedSkins, userCoins, purchasing, playerId, name, conCompras, showMessage, t]);

  /* ─── Conteo de skins poseídas por pestaña ─── */
  const ownedTileCount = TILE_CATALOG.filter(i => ownedSkins.has(i.id) || i.cost === 0).length;
  const ownedBoardCount = BOARD_CATALOG.filter(i => ownedSkins.has(i.id) || i.cost === 0).length;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="modal-card glass-panel animate-scale-up modal-a11y ov-tienda"
        {...propsPanel}
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} aria-hidden="true" />
        </button>

        {/* ─── Encabezado ─── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={24} color="#f59e0b" aria-hidden="true" />
            </div>
            <div>
              <h2 className="modal-title" style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }} {...propsTitulo}>
                <Palette size={16} style={{ opacity: 0.6 }} aria-hidden="true" />
                {t('store.title')}
              </h2>
              <span style={{ fontSize: '0.76rem', color: '#9ca3af' }}>
                {t('store.subtitle')}
              </span>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: '20px',
            fontWeight: 700, color: '#fbbf24', fontSize: '0.9rem'
          }}>
            <Coins size={16} aria-hidden="true" />
            {/* «—» no es «0». Arrancar en cero sobre un monedero que no se ha
                podido leer es lo que hacía que esta pantalla y el perfil
                afirmaran cosas distintas del mismo dato. */}
            {conCompras && estado === 'cargando' ? '…' : (userCoins != null ? userCoins : '—')}
          </div>
        </div>

        {/* LA MISMA FRANJA Y EL MISMO DATO que el perfil, el ranking y la
            agenda. El catálogo sigue navegable debajo: es un escaparate, no un
            muro de candados. */}
        {!conCompras && <p className="ov-degradado">{t('degradado.sinCompras')}</p>}

        {/* Con persistencia y sin respuesta: el vigilante de 6 s. Antes esta
            pantalla apagaba su `loading` ÚNICAMENTE dentro de `profile_data`,
            así que giraba indefinidamente cuando el servidor abortaba en
            silencio por no tener la identidad vinculada. */}
        {conCompras && estado === 'sinDatos' && (
          <p className="ov-degradado">
            <span>{t('degradado.noCargado')}</span>
            <button type="button" className="btn-premium btn-secondary" onClick={recargar}>
              {t('degradado.reintentar')}
            </button>
          </p>
        )}

        {/* ─── Preview actual ─── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '8px 12px', marginBottom: '12px',
          borderRadius: '10px', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.78rem', color: '#9ca3af', flexShrink: 0
        }}>
          <span>{t('store.equipped')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0' }}>
            <TilePreview skinId={equippedTile} />
            {TILE_CATALOG.some(i => i.id === equippedTile) ? t(`store.${equippedTile}.n`) : equippedTile}
          </span>
          <span style={{ color: '#4b5563' }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0' }}>
            <BoardPreview tableId={equippedBoard} />
            {BOARD_CATALOG.some(i => i.id === equippedBoard) ? t(`store.${equippedBoard}.n`) : equippedBoard}
          </span>
        </div>

        {/* ─── Mensaje de estado ─── */}
        {message && (
          <div role="status" style={{
            padding: '8px 12px', marginBottom: '10px', borderRadius: '8px',
            background: message.type === 'error'
              ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
            border: `1px solid ${message.type === 'error' ? '#ef4444' : '#10b981'}`,
            fontSize: '0.85rem',
            color: message.type === 'error' ? '#fca5a5' : '#34d399',
            textAlign: 'center', flexShrink: 0
          }}>
            {message.text}
          </div>
        )}

        {/* ─── Pestañas ─── */}
        <div className="chat-tabs" style={{ marginBottom: '14px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setActiveTab('tile')}
            aria-pressed={activeTab === 'tile'}
            className={`chat-tab-btn ${activeTab === 'tile' ? 'active' : ''}`}
          >
            🀌 {t('store.tabTiles')} ({ownedTileCount}/{TILE_CATALOG.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('board')}
            aria-pressed={activeTab === 'board'}
            className={`chat-tab-btn ${activeTab === 'board' ? 'active' : ''}`}
          >
            🌿 {t('store.tabBoards')} ({ownedBoardCount}/{BOARD_CATALOG.length})
          </button>
        </div>

        {/* ─── Escaparate ───
            El catálogo se pinta SIEMPRE menos mientras el perfil está en
            camino. Sin persistencia también: se puede mirar, comparar y probar
            lo gratuito; lo único que falta es el botón de comprar. */}
        {conCompras && estado === 'cargando' ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
            <Sparkles size={24} style={{ marginBottom: 8, opacity: 0.5 }} aria-hidden="true" />
            <div>{t('store.loading')}</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '10px',
            overflowY: 'auto',
            flex: 1,
            paddingRight: '4px',
            minHeight: 0
          }}>
            {items.map((item) => {
              const isEquipped = activeTab === 'tile'
                ? equippedTile === item.id
                : equippedBoard === item.id;
              const isOwned = ownedSkins.has(item.id) || item.cost === 0;
              // Sin monedero leído no se puede afirmar que no alcanza. Antes
              // `0 >= cost` daba falso para todo y el escaparate entero salía
              // con candado sobre un dato que no existía.
              const canAfford = userCoins != null && userCoins >= item.cost;
              const isBuying = purchasing === item.id;
              const bloqueado = !isOwned && !conCompras;

              return (
                <div
                  key={item.id}
                  style={{
                    padding: '12px',
                    borderRadius: '14px',
                    background: isEquipped
                      ? 'rgba(16, 185, 129, 0.08)'
                      : 'rgba(15, 23, 42, 0.7)',
                    border: isEquipped
                      ? '2px solid #10b981'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: isEquipped ? '0 0 15px rgba(16, 185, 129, 0.2)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    // El atenuado significa «no te alcanza». En un servidor sin
                    // compras no le alcanza a nadie y atenuar el catálogo
                    // entero volvería a convertirlo en un muro.
                    opacity: (conCompras && !isOwned && !canAfford) ? 0.55 : 1,
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '38px', height: '38px', borderRadius: '10px',
                      background: item.bg, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: '1.2rem',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                      flexShrink: 0
                    }}>
                      {item.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t(`store.${item.id}.n`)}
                        </h3>
                        {/* Mini preview visual */}
                        {activeTab === 'tile'
                          ? <TilePreview skinId={item.id} />
                          : <BoardPreview tableId={item.id} />
                        }
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.3, display: 'block' }}>
                        {t(`store.${item.id}.d`)}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                    {isOwned ? (
                      <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ShieldCheck size={13} aria-hidden="true" /> {t('store.owned')}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.85rem', fontWeight: 700,
                        color: canAfford ? '#fbbf24' : '#ef4444',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}>
                        {canAfford ? <Coins size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
                        {item.cost}
                      </span>
                    )}

                    {/* aria-disabled y rechazo en el manejador, nunca `disabled`:
                        un botón deshabilitado sale del orden de tabulación y su
                        nombre deja de leerse, que es justo el estado en el que
                        el jugador necesita saber POR QUÉ no puede pulsarlo. */}
                    <button
                      type="button"
                      onClick={() => handleAction(item)}
                      aria-disabled={(isEquipped || isBuying || bloqueado) ? 'true' : undefined}
                      className={`btn-premium ${isEquipped ? 'btn-secondary' : isOwned ? 'btn-accent' : canAfford ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '5px 12px', fontSize: '0.72rem', minWidth: '72px' }}
                      title={bloqueado ? t('degradado.sinCompras') : undefined}
                    >
                      {isBuying ? (
                        '...'
                      ) : isEquipped ? (
                        <><Check size={11} aria-hidden="true" /> {t('store.equippedBtn')}</>
                      ) : isOwned ? (
                        t('store.equip')
                      ) : canAfford ? (
                        t('store.buy')
                      ) : (
                        t('store.locked')
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Footer ─── */}
        <div style={{
          marginTop: '12px', paddingTop: '10px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.72rem', color: '#6b7280',
          textAlign: 'center', flexShrink: 0
        }}>
          {t('store.footer')}
        </div>
      </div>
    </div>
  );
}
