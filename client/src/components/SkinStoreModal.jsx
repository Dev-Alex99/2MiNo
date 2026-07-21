import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShoppingBag, Check, Coins, X, ShieldCheck, Sparkles, Lock, Palette } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { playGameSound } from '../audio';
import { applyTable, applySkin, TABLES, SKINS } from '../theme';

/* ───────── Catálogo de fichas (tile) ───────── */

const TILE_CATALOG = [
  { id: 'classic',       name: 'Clásico Marfil',       cost: 0,    desc: 'Diseño elegante de marfil con detalles dorados.',              icon: '🀌', bg: 'linear-gradient(135deg, #fef3c7, #d97706)' },
  { id: 'cyberpunk',     name: 'Cyberpunk Neón',        cost: 200,  desc: 'Bordes cian y magenta con brillo cibernético.',                icon: '⚡', bg: 'linear-gradient(135deg, #06b6d4, #ec4899)' },
  { id: 'obsidian',      name: 'Obsidiana de Cristal',  cost: 400,  desc: 'Cristal translúcido con puntos fosforescentes.',               icon: '💎', bg: 'linear-gradient(135deg, #1e1b4b, #6366f1)' },
  { id: 'walnut',        name: 'Nogal Artesanal',       cost: 350,  desc: 'Madera de nogal premium grabada a mano.',                     icon: '🪵', bg: 'linear-gradient(135deg, #78350f, #b45309)' },
  { id: 'rose_gold',     name: 'Oro Rosa VIP',          cost: 750,  desc: 'Fichas de oro rosa brillante con incrustaciones.',             icon: '👑', bg: 'linear-gradient(135deg, #f43f5e, #fbbf24)' },
  { id: 'midnight',      name: 'Medianoche Azul',       cost: 300,  desc: 'Tonos azul profundo con destellos estelares.',                icon: '🌙', bg: 'linear-gradient(135deg, #0c4a6e, #1e3a5f)' },
  { id: 'volcanic',      name: 'Volcánico',             cost: 500,  desc: 'Roca fundida con vetas de lava incandescente.',                icon: '🌋', bg: 'linear-gradient(135deg, #7f1d1d, #ef4444)' },
  { id: 'arctic',        name: 'Hielo Ártico',          cost: 450,  desc: 'Cristal de hielo con reflejos iridiscentes.',                  icon: '❄️', bg: 'linear-gradient(135deg, #cffafe, #22d3ee)' },
  { id: 'jade',          name: 'Jade Imperial',         cost: 600,  desc: 'Jade tallado con acabado de seda oriental.',                   icon: '🟢', bg: 'linear-gradient(135deg, #064e3b, #34d399)' },
  { id: 'golden_dragon', name: 'Dragón Dorado',         cost: 1000, desc: 'Edición legendaria con grabado de dragón en oro puro.',        icon: '🐉', bg: 'linear-gradient(135deg, #78350f, #fbbf24)' },
];

/* ───────── Catálogo de tapetes (board) ───────── */

const BOARD_CATALOG = [
  { id: 'emerald',      name: 'Esmeralda Casino',  cost: 0,    desc: 'Fieltro verde clásico de club de dominó.',                     icon: '🌿', bg: 'linear-gradient(135deg, #064e3b, #047857)' },
  { id: 'dark_oak',     name: 'Roble Oscuro',      cost: 250,  desc: 'Superficie de madera cálida para partidas nocturnas.',         icon: '🪵', bg: 'linear-gradient(135deg, #292524, #44403c)' },
  { id: 'neon_galaxy',  name: 'Galaxia Neón',      cost: 450,  desc: 'Nebulosas flotantes en el espacio profundo.',                  icon: '🌌', bg: 'linear-gradient(135deg, #0f172a, #3b82f6)' },
  { id: 'mayan_temple', name: 'Templo Maya',       cost: 600,  desc: 'Piedra dorada mística con símbolos ancestrales.',              icon: '🏛️', bg: 'linear-gradient(135deg, #451a03, #d97706)' },
  { id: 'ocean_deep',   name: 'Océano Profundo',   cost: 350,  desc: 'Aguas abisales con bioluminiscencia mágica.',                  icon: '🌊', bg: 'linear-gradient(135deg, #0c4a6e, #0ea5e9)' },
  { id: 'blood_moon',   name: 'Luna de Sangre',    cost: 500,  desc: 'Tapete carmesí bajo un eclipse lunar sangriento.',              icon: '🩸', bg: 'linear-gradient(135deg, #450a0a, #dc2626)' },
  { id: 'zen_garden',   name: 'Jardín Zen',        cost: 400,  desc: 'Arena rastrillada con piedras de río y bambú.',                 icon: '🎍', bg: 'linear-gradient(135deg, #d6d3d1, #78716c)' },
  { id: 'cyber_grid',   name: 'Grid Cyber',        cost: 550,  desc: 'Retícula holográfica con pulsos de datos.',                    icon: '🔮', bg: 'linear-gradient(135deg, #1e1b4b, #a855f7)' },
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

export default function SkinStoreModal({ playerId, name, onClose }) {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState('tile');
  const [userCoins, setUserCoins] = useState(0);
  const [equippedTile, setEquippedTile] = useState('classic');
  const [equippedBoard, setEquippedBoard] = useState('emerald');
  const [ownedSkins, setOwnedSkins] = useState(new Set(['classic', 'emerald']));
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [message, setMessage] = useState(null);
  const messageTimerRef = useRef(null);

  const showMessage = useCallback((text, type = 'success') => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage({ text, type });
    messageTimerRef.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  // Pedir perfil al abrir
  useEffect(() => {
    if (!playerId) return;
    socket.emit('get_profile', { playerId, username: name || 'Jugador' });

    function onProfileData(data) {
      if (!data) { setLoading(false); return; }
      if (data.coins !== undefined) setUserCoins(data.coins);
      if (data.equipped_tile_skin) {
        setEquippedTile(data.equipped_tile_skin);
        applySkin(data.equipped_tile_skin);
      }
      if (data.equipped_board_theme) {
        setEquippedBoard(data.equipped_board_theme);
        applyTable(data.equipped_board_theme);
      }

      const owned = new Set(['classic', 'emerald']);
      if (data.equipped_tile_skin) owned.add(data.equipped_tile_skin);
      if (data.equipped_board_theme) owned.add(data.equipped_board_theme);
      if (Array.isArray(data.ownedSkins)) {
        data.ownedSkins.forEach(s => owned.add(s));
      }
      setOwnedSkins(owned);
      setLoading(false);
    }

    function onSkinEquipped(res) {
      setPurchasing(null);
      if (res.success && res.user) {
        setUserCoins(res.user.coins);

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
          showMessage('¡Skin comprada y equipada! El cambio visual ya está activo.', 'success');
        } else {
          showMessage('Skin equipada. ¡El cambio se aplica al instante!', 'success');
        }
      } else {
        showMessage(res.error || 'Error al procesar la operación.', 'error');
      }
    }

    socket.on('profile_data', onProfileData);
    socket.on('skin_equipped', onSkinEquipped);
    return () => {
      socket.off('profile_data', onProfileData);
      socket.off('skin_equipped', onSkinEquipped);
    };
  }, [playerId, name, showMessage]);

  const items = activeTab === 'tile' ? TILE_CATALOG : BOARD_CATALOG;

  const handleAction = useCallback((item) => {
    const isEquipped = activeTab === 'tile'
      ? equippedTile === item.id
      : equippedBoard === item.id;
    if (isEquipped || purchasing) return;

    const isOwned = ownedSkins.has(item.id) || item.cost === 0;
    const costToPay = isOwned ? 0 : item.cost;

    if (!isOwned && userCoins < item.cost) {
      showMessage('¡Doblones insuficientes! Gana más partidas para obtener monedas.', 'error');
      return;
    }

    setPurchasing(item.id);
    socket.emit('equip_skin', {
      playerId,
      username: name || 'Jugador',
      category: activeTab,
      itemId: item.id,
      cost: costToPay
    });
  }, [activeTab, equippedTile, equippedBoard, ownedSkins, userCoins, purchasing, playerId, name, showMessage]);

  /* ─── Conteo de skins poseídas por pestaña ─── */
  const ownedTileCount = TILE_CATALOG.filter(i => ownedSkins.has(i.id) || i.cost === 0).length;
  const ownedBoardCount = BOARD_CATALOG.filter(i => ownedSkins.has(i.id) || i.cost === 0).length;

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 1200 }} onClick={onClose}>
      <div
        className="modal-card glass-panel animate-scale-up"
        style={{ maxWidth: '660px', width: '94%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <button className="modal-close-btn" onClick={onClose}>
          <X size={18} />
        </button>

        {/* ─── Encabezado ─── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="modal-icon-circle winner" style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={24} color="#f59e0b" />
            </div>
            <div>
              <h2 className="modal-title" style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Palette size={16} style={{ opacity: 0.6 }} />
                Tienda & Apariencia
              </h2>
              <span style={{ fontSize: '0.76rem', color: '#9ca3af' }}>
                Compra, equipa y previsualiza al instante
              </span>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: '20px',
            fontWeight: 700, color: '#fbbf24', fontSize: '0.9rem'
          }}>
            <Coins size={16} />
            {loading ? '...' : userCoins}
          </div>
        </div>

        {/* ─── Preview actual ─── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '8px 12px', marginBottom: '12px',
          borderRadius: '10px', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.78rem', color: '#9ca3af', flexShrink: 0
        }}>
          <span>Equipado:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0' }}>
            <TilePreview skinId={equippedTile} />
            {TILE_CATALOG.find(i => i.id === equippedTile)?.name || equippedTile}
          </span>
          <span style={{ color: '#4b5563' }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0' }}>
            <BoardPreview tableId={equippedBoard} />
            {BOARD_CATALOG.find(i => i.id === equippedBoard)?.name || equippedBoard}
          </span>
        </div>

        {/* ─── Mensaje de estado ─── */}
        {message && (
          <div style={{
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
            onClick={() => setActiveTab('tile')}
            className={`chat-tab-btn ${activeTab === 'tile' ? 'active' : ''}`}
          >
            🀌 Fichas ({ownedTileCount}/{TILE_CATALOG.length})
          </button>
          <button
            onClick={() => setActiveTab('board')}
            className={`chat-tab-btn ${activeTab === 'board' ? 'active' : ''}`}
          >
            🌿 Tapetes ({ownedBoardCount}/{BOARD_CATALOG.length})
          </button>
        </div>

        {/* ─── Grid de items ─── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
            <Sparkles size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
            <div>Cargando tu inventario...</div>
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
              const canAfford = userCoins >= item.cost;
              const isBuying = purchasing === item.id;

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
                    opacity: (!isOwned && !canAfford) ? 0.55 : 1,
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
                          {item.name}
                        </h3>
                        {/* Mini preview visual */}
                        {activeTab === 'tile'
                          ? <TilePreview skinId={item.id} />
                          : <BoardPreview tableId={item.id} />
                        }
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.3, display: 'block' }}>
                        {item.desc}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                    {isOwned ? (
                      <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ShieldCheck size={13} /> Adquirido
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.85rem', fontWeight: 700,
                        color: canAfford ? '#fbbf24' : '#ef4444',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}>
                        {canAfford ? <Coins size={13} /> : <Lock size={13} />}
                        {item.cost}
                      </span>
                    )}

                    <button
                      onClick={() => handleAction(item)}
                      disabled={isEquipped || isBuying}
                      className={`btn-premium ${isEquipped ? 'btn-secondary' : isOwned ? 'btn-accent' : canAfford ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '5px 12px', fontSize: '0.72rem', minWidth: '72px' }}
                    >
                      {isBuying ? (
                        '...'
                      ) : isEquipped ? (
                        <><Check size={11} /> Equipado</>
                      ) : isOwned ? (
                        'Equipar'
                      ) : canAfford ? (
                        'Comprar'
                      ) : (
                        'Bloqueado'
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
          Gana Doblones jugando · Victoria: +50 · Derrota: +10 · Los cambios se aplican al instante
        </div>
      </div>
    </div>
  );
}
