import React, { useEffect, useRef } from 'react';
import { Zap, RefreshCw, Shield, Sparkles } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

export default function LegendaryEffect({ effect, onClose }) {
  const { t } = useT();
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!effect) return;
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, 3200);
    return () => clearTimeout(timer);
  }, [effect, onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const particleCount = 70;
    const particles = [];
    const color = effect?.id === 'mind_swap' ? '#a78bfa' : (effect?.id === 'russian_roulette' ? '#f43f5e' : '#38bdf8');

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        dist: Math.random() * (Math.min(w, h) * 0.45),
        speed: 0.02 + Math.random() * 0.04,
        size: Math.random() * 6 + 2,
        opacity: Math.random() * 0.8 + 0.2
      });
    }

    let animId;
    let rotation = 0;

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      rotation += 0.02;

      // Dibujar vórtice central
      const cx = w / 2;
      const cy = h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      particles.forEach(p => {
        p.angle += p.speed;
        p.dist *= 0.99;
        if (p.dist < 20) p.dist = Math.min(w, h) * 0.45;

        const x = Math.cos(p.angle) * p.dist;
        const y = Math.sin(p.angle) * p.dist;

        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
      });

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
    };
  }, [effect]);

  if (!effect) return null;

  const getEffectTitle = () => {
    switch (effect.id) {
      case 'mind_swap': return t('pw.mind_swap.n');
      case 'russian_roulette': return t('pw.russian_roulette.n');
      case 'block_both': return t('pw.block_both.n');
      default: return effect.title || 'PODER LEGENDARIO';
    }
  };

  const getEffectIcon = () => {
    switch (effect.id) {
      case 'mind_swap': return <RefreshCw size={54} className="legendary-icon-spin" />;
      case 'russian_roulette': return <Sparkles size={54} className="legendary-icon-pulse" />;
      case 'block_both': return <Shield size={54} className="legendary-icon-glow" />;
      default: return <Zap size={54} />;
    }
  };

  return (
    <div className="legendary-vortex-overlay">
      <canvas ref={canvasRef} className="legendary-vortex-canvas" />

      <div className="legendary-content-card animate-scale-up">
        <div className="legendary-badge-header">
          <Sparkles size={14} /> PODER LEGENDARIO ACTIVADO
        </div>

        <div className="legendary-icon-wrapper">
          {getEffectIcon()}
        </div>

        <h2 className="legendary-title">{getEffectTitle()}</h2>
        {effect.casterName && (
          <p className="legendary-sub">
            Invocado por <strong style={{ color: '#ffffff' }}>{effect.casterName}</strong>
          </p>
        )}
      </div>
    </div>
  );
}
