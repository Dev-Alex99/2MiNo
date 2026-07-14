import { io } from 'socket.io-client';

// Detectar automáticamente el servidor. Si estamos en desarrollo local,
// apuntamos al puerto 3000 del mismo host (para que funcione en red local con móviles u otros PCs).
const PORT = 3001;
const isLocal = 
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.startsWith('192.168.') ||
  window.location.hostname.startsWith('10.') ||
  window.location.hostname.startsWith('172.');

const socketUrl = import.meta.env.VITE_SERVER_URL || (isLocal
  ? `${window.location.protocol}//${window.location.hostname}:${PORT}`
  : window.location.origin);

console.log(`Conectando Socket.IO a: ${socketUrl}`);

export const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1000
});
