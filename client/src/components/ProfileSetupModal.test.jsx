import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileSetupModal from './ProfileSetupModal';
import ProfileModal from './ProfileModal';
import { render, resetStores, setGameStore } from '../test/utils';
import { useGameStore, exportAccountKey, importAccountKey } from '../store/useGameStore';

const socket = globalThis.__socket;

describe('Persistencia y Gestión de Perfil', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
  });

  describe('Clave de Cuenta (exportAccountKey & importAccountKey)', () => {
    it('exporta una clave con prefijo 2MINO- y contiene datos del usuario', () => {
      setGameStore({ cuentaId: 'p_alex123', name: 'AlexMaster', avatar: '🦊' });
      localStorage.setItem('domino_persistent_player_id', 'p_alex123');
      localStorage.setItem('domino_username', 'AlexMaster');
      localStorage.setItem('domino_avatar', '🦊');
      localStorage.setItem('domino_session_token', 'tok_abc');

      const key = exportAccountKey();
      expect(key).toMatch(/^2MINO-/);

      const parsed = importAccountKey(key);
      expect(parsed.success).toBe(true);
      expect(parsed.data.pid).toBe('p_alex123');
      expect(parsed.data.name).toBe('AlexMaster');
      expect(parsed.data.avatar).toBe('🦊');
      expect(parsed.data.token).toBe('tok_abc');
    });

    it('rechaza claves inválidas o corruptas', () => {
      expect(importAccountKey('').success).toBe(false);
      expect(importAccountKey('2MINO-invalido').success).toBe(false);
      expect(importAccountKey('12345').success).toBe(false);
    });

    it('al importar clave válida actualiza localStorage y useGameStore', () => {
      localStorage.setItem('domino_persistent_player_id', 'p_restored');
      localStorage.setItem('domino_session_token', 'sec_tok');
      localStorage.setItem('domino_username', 'Restaurado');
      localStorage.setItem('domino_avatar', '🐉');
      const key = exportAccountKey();

      localStorage.clear();
      const res = importAccountKey(key);
      expect(res.success).toBe(true);

      expect(localStorage.getItem('domino_persistent_player_id')).toBe('p_restored');
      expect(localStorage.getItem('domino_username')).toBe('Restaurado');
      expect(localStorage.getItem('domino_avatar')).toBe('🐉');

      expect(useGameStore.getState().cuentaId).toBe('p_restored');
      expect(useGameStore.getState().name).toBe('Restaurado');
      expect(useGameStore.getState().avatar).toBe('🐉');
    });
  });

  describe('ProfileSetupModal', () => {
    it('renderiza título de bienvenida, avatares y campo de apodo', () => {
      render(<ProfileSetupModal onClose={() => {}} />);
      expect(screen.getByText('¡Bienvenido a 2MiNo!')).toBeInTheDocument();
      expect(screen.getByText('Elige tu Avatar')).toBeInTheDocument();
      expect(screen.getByText('Tu Apodo')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Comenzar a Jugar' })).toBeInTheDocument();
    });

    it('permite seleccionar un nuevo avatar', async () => {
      const usuario = userEvent.setup();
      render(<ProfileSetupModal onClose={() => {}} />);

      const dragonBtn = screen.getByRole('radio', { name: '🐉' });
      expect(dragonBtn).toBeInTheDocument();
      await usuario.click(dragonBtn);

      expect(dragonBtn).toHaveClass('active');
    });

    it('el botón de dados genera un apodo aleatorio', async () => {
      const usuario = userEvent.setup();
      render(<ProfileSetupModal onClose={() => {}} />);

      const input = screen.getByPlaceholderText('Ej: CapicúaKing');
      expect(input.value).toBe('');

      const diceBtn = screen.getByRole('button', { name: 'Nombre aleatorio' });
      await usuario.click(diceBtn);

      expect(input.value.length).toBeGreaterThan(0);
    });

    it('al pulsar comenzar a jugar guarda en store y emite update_profile', async () => {
      const usuario = userEvent.setup();
      const onClose = vi.fn();
      const onCompleted = vi.fn();
      let emitArgs = null;

      if (socket) {
        socket.connected = true;
        vi.spyOn(socket, 'emit').mockImplementation((ev, args) => {
          if (ev === 'update_profile') emitArgs = args;
        });
      }

      render(<ProfileSetupModal onClose={onClose} onCompleted={onCompleted} />);

      const dragonBtn = screen.getByRole('radio', { name: '🐉' });
      await usuario.click(dragonBtn);

      const input = screen.getByPlaceholderText('Ej: CapicúaKing');
      await usuario.clear(input);
      await usuario.type(input, 'SuperCrack');

      const startBtn = screen.getByRole('button', { name: 'Comenzar a Jugar' });
      await usuario.click(startBtn);

      expect(useGameStore.getState().name).toBe('SuperCrack');
      expect(useGameStore.getState().avatar).toBe('🐉');
      expect(localStorage.getItem('domino_username')).toBe('SuperCrack');
      expect(localStorage.getItem('domino_avatar')).toBe('🐉');
      expect(onClose).toHaveBeenCalled();
      expect(onCompleted).toHaveBeenCalledWith({ name: 'SuperCrack', avatar: '🐉' });
      if (socket && socket.connected) {
        expect(emitArgs).toEqual({ username: 'SuperCrack', avatar: '🐉' });
      }
    });

    it('permite restaurar cuenta pegando una clave válida', async () => {
      const usuario = userEvent.setup();
      const onClose = vi.fn();

      localStorage.setItem('domino_persistent_player_id', 'p_retrieved');
      localStorage.setItem('domino_session_token', 'tok_saved');
      localStorage.setItem('domino_username', 'CuentaAntigua');
      localStorage.setItem('domino_avatar', '👑');
      const key = exportAccountKey();
      localStorage.clear();

      render(<ProfileSetupModal onClose={onClose} />);

      const toggleRestore = screen.getByRole('button', { name: /¿Ya tienes una cuenta en otro dispositivo\?/i });
      await usuario.click(toggleRestore);

      const restoreInput = screen.getByPlaceholderText(/Pega tu clave 2MINO-\.\.\. aquí/i);
      await usuario.type(restoreInput, key);

      const restoreBtn = screen.getByRole('button', { name: 'Restaurar' });
      await usuario.click(restoreBtn);

      expect(screen.getByText('¡Cuenta restaurada con éxito!')).toBeInTheDocument();
      expect(useGameStore.getState().cuentaId).toBe('p_retrieved');
      expect(useGameStore.getState().name).toBe('CuentaAntigua');
      expect(useGameStore.getState().avatar).toBe('👑');
    });
  });

  describe('ProfileModal - Edición y Clave de Cuenta', () => {
    it('muestra el avatar configurado y botón para editar perfil', () => {
      setGameStore({ name: 'Alex', avatar: '🦁', cuentaId: 'p_alex' });
      render(<ProfileModal name="Alex" onClose={() => {}} />);

      expect(screen.getByText('🦁')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar Perfil' })).toBeInTheDocument();
    });

    it('despliega el panel de edición al hacer clic en Editar Perfil', async () => {
      const usuario = userEvent.setup();
      setGameStore({ name: 'Alex', avatar: '🦁', cuentaId: 'p_alex' });
      render(<ProfileModal name="Alex" onClose={() => {}} />);

      const editBtn = screen.getByRole('button', { name: 'Editar Perfil' });
      await usuario.click(editBtn);

      expect(screen.getByText('Elige tu Avatar')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument();
    });

    it('muestra la sección de Clave de Cuenta con botón de copiar', () => {
      setGameStore({ name: 'Alex', avatar: '🦁', cuentaId: 'p_alex' });
      render(<ProfileModal name="Alex" onClose={() => {}} />);

      expect(screen.getByText('Clave de Cuenta y Transferencia')).toBeInTheDocument();
      expect(screen.getByText(/Guarda esta clave secreta/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copiar Clave' })).toBeInTheDocument();
    });
  });
});
