import React from 'react';
import { useHubStore } from '../../hub/stores/useHubStore';
import { ArrowLeft, Gamepad2 } from 'lucide-react';

/**
 * TemplateBoard - Plantilla visual base para la interfaz de nuevos juegos.
 * Copia esta carpeta como `client/src/games/mi_nuevo_juego/` para construir la UI.
 */
export default function TemplateBoard({ gameState, onLeave }) {
  const returnToHub = useHubStore((state) => state.returnToHub);

  return (
    <div className="template-game-container min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 relative">
      {/* Top Bar */}
      <header className="absolute top-0 left-0 w-full p-4 flex items-center justify-between bg-slate-900/80 border-b border-slate-800">
        <button
          onClick={onLeave || returnToHub}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver</span>
        </button>

        <div className="flex items-center gap-2">
          <Gamepad2 className="w-5 h-5 text-indigo-400" />
          <h1 className="font-bold text-lg">Nuevo Juego (Plantilla)</h1>
        </div>
      </header>

      {/* Main Board Container */}
      <div className="w-full max-w-4xl bg-slate-900/90 rounded-3xl p-8 border border-slate-800 flex flex-col items-center gap-6 shadow-2xl text-center">
        <h2 className="text-3xl font-black text-indigo-300">Tablero de Juego</h2>
        <p className="text-slate-400 text-sm max-w-md">
          Este es el contenedor base para renderizar la interfaz del nuevo juego (Ludo, Uno, Ajedrez, etc.).
        </p>

        <div className="w-64 h-64 bg-slate-800/80 rounded-2xl border border-indigo-500/30 flex items-center justify-center text-4xl shadow-inner">
          🎲
        </div>
      </div>
    </div>
  );
}
