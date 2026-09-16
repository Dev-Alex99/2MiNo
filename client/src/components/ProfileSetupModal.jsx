import React, { useState } from 'react';
import { X, Sparkles, Dices, Key, Check, AlertCircle, ShieldCheck } from 'lucide-react';
import { socket } from '../socket';
import { useT } from '../i18n/LanguageContext';
import { useGameStore, importAccountKey } from '../store/useGameStore';
import useModalA11y from '../hooks/useModalA11y';

export const AVATAR_OPTIONS = [
  '🎲', '🦊', '🐉', '👑', '⚡', '🎯',
  '🚀', '💎', '🀄', '🦁', '🐼', '🦉',
  '🏆', '🔥', '🌟', '🦄'
];

export const FUN_NICKNAMES = [
  'CapicúaKing', 'ElReyDelPaso', 'FichaDorada', 'DobleSeis',
  'Relámpago', 'AstroDominó', 'MesaDeOro', 'ChivoBrillante',
  'SopaDeFichas', 'TrancaMaestro', 'ElTigreDominó', 'DominóMaster',
  'AsDePique', 'FichaNeón', 'CapicúaPro'
];

export default function ProfileSetupModal({ onClose, onCompleted }) {
  const { t } = useT();
  const currentName = useGameStore((s) => s.name);
  const currentAvatar = useGameStore((s) => s.avatar);
  const setName = useGameStore((s) => s.setName);
  const setAvatar = useGameStore((s) => s.setAvatar);

  const [nickname, setNickname] = useState(currentName || '');
  const [selectedAvatar, setSelectedAvatar] = useState(currentAvatar || '🎲');
  const [showRestore, setShowRestore] = useState(false);
  const [accountKeyInput, setAccountKeyInput] = useState('');
  const [restoreStatus, setRestoreStatus] = useState({ error: '', success: '' });

  const { propsPanel, propsTitulo } = useModalA11y(onClose);

  const handleRandomize = () => {
    const randomName = FUN_NICKNAMES[Math.floor(Math.random() * FUN_NICKNAMES.length)];
    setNickname(randomName);
  };

  const handleSave = () => {
    const cleanName = nickname.trim() || FUN_NICKNAMES[Math.floor(Math.random() * FUN_NICKNAMES.length)];
    setName(cleanName);
    setAvatar(selectedAvatar);

    try {
      localStorage.setItem('domino_profile_configured', 'true');
    } catch { /* noop */ }

    if (socket && socket.connected) {
      socket.emit('update_profile', { username: cleanName, avatar: selectedAvatar });
    }

    if (onCompleted) onCompleted({ name: cleanName, avatar: selectedAvatar });
    onClose();
  };

  const handleRestore = () => {
    if (!accountKeyInput.trim()) return;
    const res = importAccountKey(accountKeyInput);
    if (res.success) {
      setRestoreStatus({ error: '', success: t('profile.restoreSuccess') });
      try {
        localStorage.setItem('domino_profile_configured', 'true');
      } catch { /* noop */ }

      if (socket && socket.connected) {
        socket.emit('verify_session', {
          accountId: res.data.pid,
          token: res.data.token,
          username: res.data.name
        });
        socket.emit('update_profile', {
          username: res.data.name,
          avatar: res.data.avatar
        });
      }

      setTimeout(() => {
        if (onCompleted) onCompleted({ name: res.data.name, avatar: res.data.avatar });
        onClose();
      }, 700);
    } else {
      setRestoreStatus({ error: t('profile.restoreError'), success: '' });
    }
  };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="modal-card glass-panel animate-scale-up profile-setup-card modal-a11y"
        {...propsPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="profile-close"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          <X size={18} aria-hidden="true" />
        </button>

        {/* Cabecera Onboarding */}
        <div className="setup-head">
          <div className="setup-avatar-preview">
            <span className="setup-avatar-emoji">{selectedAvatar}</span>
          </div>
          <h2 className="setup-title" {...propsTitulo}>
            {t('setup.welcome')}
          </h2>
          <p className="setup-subtitle">
            {t('setup.subtitle')}
          </p>
        </div>

        {/* Selector de Avatar */}
        <div className="setup-section">
          <label className="setup-label">
            {t('profile.editAvatar')}
          </label>
          <div className="setup-avatar-grid" role="radiogroup" aria-label={t('profile.editAvatar')}>
            {AVATAR_OPTIONS.map((emoji) => {
              const isSelected = selectedAvatar === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`avatar-pick-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedAvatar(emoji)}
                >
                  <span className="avatar-pick-emoji">{emoji}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Input de Apodo + Botón de Dados */}
        <div className="setup-section">
          <label className="setup-label" htmlFor="setup-nickname-input">
            {t('profile.editName')}
          </label>
          <div className="setup-input-row">
            <input
              id="setup-nickname-input"
              type="text"
              className="input-premium setup-name-input"
              maxLength={16}
              placeholder="Ej: CapicúaKing"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.substring(0, 16))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <button
              type="button"
              className="btn-premium btn-secondary setup-dice-btn"
              onClick={handleRandomize}
              title={t('profile.randomName')}
              aria-label={t('profile.randomName')}
            >
              <Dices size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Botón Principal: Comenzar a Jugar */}
        <div className="setup-actions">
          <button
            type="button"
            className="btn-premium btn-primary setup-save-btn"
            onClick={handleSave}
          >
            <Sparkles size={16} aria-hidden="true" />
            {t('setup.start')}
          </button>
        </div>

        {/* Sección de Recuperación / Transferencia de Cuenta */}
        <div className="setup-restore-wrapper">
          {!showRestore ? (
            <button
              type="button"
              className="setup-restore-toggle"
              onClick={() => setShowRestore(true)}
            >
              <Key size={13} aria-hidden="true" />
              {t('setup.haveAccount')}
            </button>
          ) : (
            <div className="setup-restore-box animate-scale-up">
              <label className="setup-restore-label" htmlFor="setup-restore-input">
                <ShieldCheck size={14} aria-hidden="true" />
                {t('profile.restoreAccountDesc')}
              </label>
              <div className="setup-restore-input-row">
                <input
                  id="setup-restore-input"
                  type="text"
                  className="input-premium setup-key-input"
                  placeholder={t('profile.pasteKeyPlaceholder')}
                  value={accountKeyInput}
                  onChange={(e) => setAccountKeyInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-premium btn-secondary setup-restore-submit"
                  onClick={handleRestore}
                >
                  <Check size={14} aria-hidden="true" />
                  {t('profile.restoreBtn')}
                </button>
              </div>

              {restoreStatus.error && (
                <div className="setup-restore-msg error" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  {restoreStatus.error}
                </div>
              )}
              {restoreStatus.success && (
                <div className="setup-restore-msg success" role="status">
                  <Check size={13} aria-hidden="true" />
                  {restoreStatus.success}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
