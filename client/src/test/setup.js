import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createFakeSocket } from './fakeSocket';

// Un único doble de socket para toda la suite. Se expone en globalThis para que
// el factory del mock (que se evalúa perezosamente) pueda alcanzarlo sin caer en
// la zona muerta temporal del hoisting de `vi.mock`.
globalThis.__socket = createFakeSocket();

vi.mock('../socket', () => ({
  socket: globalThis.__socket,
  serverUrl: 'http://test.local'
}));

// jsdom no implementa varias APIs de navegador que la app usa al montar. Sin
// estos dobles, cualquier render revienta por motivos que no son el fallo que
// se quiere detectar.

// useIsMobile
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
}

// GameBoard mide el tablero con ResizeObserver
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// audio.js abre un AudioContext en el primer sonido
if (!window.AudioContext) {
  window.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
    createOscillator() {
      return {
        connect: () => {}, start: () => {}, stop: () => {},
        frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        type: 'sine'
      };
    }
    createGain() {
      return {
        connect: () => {},
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
          linearRampToValueAtTime: () => {}
        }
      };
    }
    resume() { return Promise.resolve(); }
  };
}

// WebRTC / medios: la app los toca al montar el proveedor de voz.
//
// A propósito SIN `enumerateDevices`: jsdom no implementa la enumeración de
// dispositivos, y `useVoiceChat` ya se protege comprobando que exista. Dárselo
// falso sólo servía para que `refreshDevices()` hiciera un `setDevices` después
// de un `await`, es decir, una actualización de estado fuera de `act()` que
// ensuciaba la salida de todos los tests con un aviso que no señalaba nada real.
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    value: {
      getUserMedia: () => Promise.reject(new Error('sin medios en jsdom')),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  });
}
if (!globalThis.RTCPeerConnection) {
  globalThis.RTCPeerConnection = class {
    constructor() { this.signalingState = 'stable'; }
    addTrack() { return {}; }
    getSenders() { return []; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: '' }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: '' }); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    close() {}
  };
}
if (!globalThis.MediaStream) {
  globalThis.MediaStream = class {
    constructor(tracks = []) { this._t = tracks; }
    getTracks() { return this._t; }
    getAudioTracks() { return []; }
    getVideoTracks() { return []; }
  };
}

// jsdom no reproduce medios
window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
window.HTMLMediaElement.prototype.pause = vi.fn();

// /ice-config
if (!globalThis.fetch) {
  globalThis.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ iceServers: [] })
  }));
}

afterEach(() => {
  cleanup();
  globalThis.__socket.reset();
  localStorage.clear();
  sessionStorage.clear();
});
