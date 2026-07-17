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

// Exportada para que otras piezas (p. ej. el chat de voz, que pide /ice-config)
// no dependan de la API interna del manager de Socket.IO.
export const serverUrl = socketUrl;

console.log(`Conectando Socket.IO a: ${socketUrl}`);

export const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  // Nunca rendirse: en móvil se cambia de WiFi a 4G, se pasa por túneles y se
  // pierde señal en ascensores. Como al reconectar resincronizamos por ESTADO
  // COMPLETO, recuperar es barato y seguro por muchos intentos que haga.
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5
  // Nota: se mantiene el fallback polling->websocket por defecto. Forzar
  // 'websocket' aligeraría el servidor de 512MB, pero rompería la conectividad
  // tras proxies que bloquean websocket. Queda como decisión aparte.
});
