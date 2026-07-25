import { create } from 'zustand';

export const useHubStore = create((set) => ({
  // Juego actualmente seleccionado en el Hub (null = Pantalla Principal del Hub)
  selectedGameId: null,
  
  // Lista de juegos registrados en la plataforma
  availableGames: [
    {
      id: 'domino',
      name: 'Dominó Online',
      subtitle: 'Clásico & Cartas de Poder',
      category: 'Mesa & Estrategia',
      players: '2-4 Jugadores',
      status: 'available',
      badge: 'POPULAR',
      icon: '🀁',
      color: 'from-blue-600 to-indigo-800',
      description: 'El clásico juego de dominó en variantes Doble 6 y Doble 9, modo individual y en parejas, con cartas de poderes especiales.'
    },
    {
      id: 'tictactoe',
      name: 'Tres en Raya',
      subtitle: 'Duelos 3x3 X y O',
      category: 'Estrategia',
      players: '2 Jugadores',
      status: 'available',
      badge: 'NUEVO',
      icon: '❌',
      color: 'from-purple-600 to-indigo-800',
      description: 'El clásico duelo 3x3 de X y O con gráficos neón, sonidos dinámicos e IA de bot.'
    },
    {
      id: 'ludo',
      name: 'Ludo Star',
      subtitle: 'Carrera & Estrategia',
      category: 'Mesa',
      players: '2-4 Jugadores',
      status: 'coming_soon',
      badge: 'PRÓXIMAMENTE',
      icon: '🎲',
      color: 'from-emerald-600 to-teal-800',
      description: 'Compite con tus fichas en el tablero clásico de Ludo. Lanza el dado y llega primero a la meta.'
    },
    {
      id: 'uno',
      name: 'Uno Master',
      subtitle: 'Cartas Rápido',
      category: 'Cartas',
      players: '2-4 Jugadores',
      status: 'coming_soon',
      badge: 'DESARROLLO',
      icon: '🃏',
      color: 'from-red-600 to-rose-800',
      description: 'Partidas dinámicas de cartas. Haz coincidir colores y números y no olvides gritar ¡UNO!'
    },
    {
      id: 'chess',
      name: 'Ajedrez Blitz',
      subtitle: 'Mente & Táctica',
      category: 'Estrategia',
      players: '2 Jugadores',
      status: 'coming_soon',
      badge: 'EN CAMINO',
      icon: '♟️',
      color: 'from-amber-600 to-yellow-800',
      description: 'Duelos de ajedrez rápido con partidas puntuadas en tiempo real.'
    }
  ],

  // Acciones
  setSelectedGameId: (gameId) => set({ selectedGameId: gameId }),
  returnToHub: () => set({ selectedGameId: null })
}));
