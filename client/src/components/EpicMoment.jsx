import React, { useEffect, useRef } from 'react';
import { Camera } from 'lucide-react';
import { useVoice } from '../voice/VoiceContext';
import { useT } from '../i18n/LanguageContext';

const ACCENTS = {
  domino: '#10b981',
  tranca: '#f59e0b',
  power: '#a78bfa',
  victory: '#fbbf24',
  comeback: '#fbbf24'
};

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawCover(ctx, media, dx, dy, dw, dh) {
  const mw = media.videoWidth || media.width;
  const mh = media.videoHeight || media.height;
  if (!mw || !mh) return false;
  const scale = Math.max(dw / mw, dh / mh);
  const sw = dw / scale;
  const sh = dh / scale;
  ctx.drawImage(media, (mw - sw) / 2, (mh - sh) / 2, sw, sh, dx, dy, dw, dh);
  return true;
}

export default function EpicMoment({ moment, gameState, playerId }) {
  const { t } = useT();
  const voice = useVoice();
  const videoRef = useRef(null);
  const confettiCanvasRef = useRef(null);

  const star = moment ? (gameState.players || []).find(p => p.id === moment.starId) : null;
  const accent = ACCENTS[moment?.kind] || '#10b981';

  const stream = star && voice
    ? (star.id === playerId ? voice.localVideo : (voice.remoteVideos || {})[star.id])
    : null;
  const showVideo = !!(star && star.camOn && stream);

  useEffect(() => {
    const el = videoRef.current;
    if (el && showVideo && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [showVideo, stream]);

  // Sistema de partículas / Confeti Neón en Canvas
  useEffect(() => {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const colors = [accent, '#ffffff', '#34d399', '#fbbf24', '#818cf8', '#f43f5e', '#60a5fa'];
    const particleCount = 120;
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 14;
      particles.push({
        x: width / 2,
        y: height * 0.38,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        size: Math.random() * 9 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.25,
        opacity: 1,
        gravity: 0.16 + Math.random() * 0.12,
        shape: Math.random() > 0.35 ? 'rect' : 'circle'
      });
    }

    let animId;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.98;
        p.rotation += p.vRot;
        p.opacity -= 0.006;

        if (p.opacity <= 0) return;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
    };
  }, [accent]);

  if (!moment) return null;

  const captureMoment = async () => {
    try {
      const S = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext('2d');

      const bg = ctx.createLinearGradient(0, 0, S, S);
      bg.addColorStop(0, '#0b1222'); bg.addColorStop(1, '#02040a');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
      const glow = ctx.createRadialGradient(S / 2, S * 0.4, 40, S / 2, S * 0.4, S * 0.62);
      glow.addColorStop(0, hexToRgba(accent, 0.38)); glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, S, S);

      const cx = S / 2, cy = S * 0.4, r = 210;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      let drew = false;
      const v = videoRef.current;
      if (showVideo && v && v.readyState >= 2) {
        drew = drawCover(ctx, v, cx - r, cy - r, r * 2, r * 2);
      }
      if (!drew) {
        const ag = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        ag.addColorStop(0, accent); ag.addColorStop(1, '#059669');
        ctx.fillStyle = ag; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = '800 150px Outfit, Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(initials(star?.name), cx, cy + 8);
      }
      ctx.restore();
      ctx.strokeStyle = accent; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.font = '800 104px Outfit, Arial, sans-serif';
      ctx.fillText((moment.title || '').toUpperCase(), S / 2, S * 0.74);
      if (moment.sub) {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 46px Outfit, Arial, sans-serif';
        ctx.fillText(moment.sub, S / 2, S * 0.81);
      }
      ctx.fillStyle = '#64748b';
      ctx.font = '600 36px Outfit, Arial, sans-serif';
      ctx.fillText('2mino.lat', S / 2, S * 0.93);

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'momento-2mino.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: '2MiNo', text: `${moment.title} · 2mino.lat` });
            return;
          } catch { /* noop */ }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'momento-2mino.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch { /* noop */ }
  };

  return (
    <div className="epic-overlay" style={{ '--epic': accent }}>
      <canvas ref={confettiCanvasRef} className="epic-confetti-canvas" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
      <div className="epic-vignette" />

      <div className="epic-stage">
        <div className="epic-spotlight">
          {showVideo ? (
            <video ref={videoRef} autoPlay playsInline muted className="epic-video" />
          ) : (
            <span className="epic-avatar">{initials(star?.name)}</span>
          )}
        </div>

        <div className="epic-banner">{(moment.title || '').toUpperCase()}</div>
        {moment.sub && <div className="epic-sub">{moment.sub}</div>}

        <button className="epic-capture" onClick={captureMoment}>
          <Camera size={16} />
          {t('epic.capture')}
        </button>
      </div>
    </div>
  );
}
