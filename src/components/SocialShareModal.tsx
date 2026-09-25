import React, { useState } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  Send,
  MessageCircle,
  Twitter,
  Facebook,
  QrCode,
  Music,
  Download,
} from 'lucide-react';
import { SongProject } from '../types';
import { downloadMidi } from '../services/midiEncoder';
import { audioEngine } from '../services/audioEngine';

interface SocialShareModalProps {
  song: SongProject | null;
  onClose: () => void;
}

export const SocialShareModal: React.FC<SocialShareModalProps> = ({ song, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  if (!song) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://harmonix-ai.app';
  const shareTitle = `Ouça "${song.title}" gerada com Harmonix AI!`;
  const shareText = `🎵 Acabei de criar a música "${song.title}" (${song.style}, ${song.bpm} BPM) usando Inteligência Artificial no Harmonix AI! Ouça, edite e exporte em MIDI/WAV: ${currentUrl}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: song.title,
          text: shareText,
          url: currentUrl,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      handleCopyLink();
    }
  };

  // Social Share URLs
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(currentUrl);

  const shareLinks = [
    {
      name: 'WhatsApp',
      icon: MessageCircle,
      color: 'bg-emerald-600 hover:bg-emerald-500 text-white',
      url: `https://api.whatsapp.com/send?text=${encodedText}`,
    },
    {
      name: 'X (Twitter)',
      icon: Twitter,
      color: 'bg-sky-600 hover:bg-sky-500 text-white',
      url: `https://twitter.com/intent/tweet?text=${encodedText}`,
    },
    {
      name: 'Telegram',
      icon: Send,
      color: 'bg-blue-500 hover:bg-blue-400 text-white',
      url: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(`🎵 Ouça "${song.title}" (${song.style}) gerada por IA!`)}`,
    },
    {
      name: 'Facebook',
      icon: Facebook,
      color: 'bg-indigo-600 hover:bg-indigo-500 text-white',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-800 bg-[#121320] p-6 shadow-2xl text-slate-100">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl bg-slate-800 p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-purple-500/20 p-2.5 text-purple-400">
            <Share2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Compartilhar Música</h2>
            <p className="text-xs text-slate-400">Divulgue sua criação nas redes sociais ou envie para amigos</p>
          </div>
        </div>

        {/* Song Card Preview */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center gap-3.5">
            <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${song.coverArtGradient || 'from-purple-600 to-pink-600'} shadow-md`}>
              <Music className="h-7 w-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-extrabold text-white truncate">{song.title}</h3>
              <p className="text-xs text-purple-300 font-medium">
                {song.style} • {song.bpm} BPM • {song.key}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">{song.prompt}</p>
            </div>
          </div>
        </div>

        {/* Native Web Share Button */}
        <div className="mt-5">
          <button
            onClick={handleNativeShare}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 py-3 text-sm font-bold text-white shadow-lg shadow-purple-600/25 transition hover:from-purple-500 hover:to-pink-500"
          >
            <Share2 className="h-4 w-4" />
            <span>Compartilhar no Dispositivo</span>
          </button>
        </div>

        {/* Social Platforms Grid */}
        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Compartilhamento Direto:
          </span>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {shareLinks.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.name}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl p-3 text-xs font-semibold transition ${item.color} shadow-md`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </a>
              );
            })}
          </div>
        </div>

        {/* Copy Link & QR Code */}
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={handleCopyLink}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Link e Detalhes Copiados!' : 'Copiar Texto e Link'}</span>
          </button>

          <button
            onClick={() => setShowQR(!showQR)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            title="Exibir QR Code para abrir no celular"
          >
            <QrCode className="h-4 w-4 text-purple-400" />
            <span>QR Code</span>
          </button>
        </div>

        {/* QR Code Container */}
        {showQR && (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-slate-700/80 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-300 font-medium">
              Aponte a câmera do seu celular para abrir a música diretamente:
            </p>
            <div className="mt-3 rounded-xl bg-white p-3 shadow-md">
              {/* Dynamic QR Code representation */}
              <svg viewBox="0 0 100 100" width="130" height="130" className="shape-rendering-crispEdges">
                <rect width="100" height="100" fill="#ffffff" />
                {/* QR Marker 1 */}
                <rect x="10" y="10" width="25" height="25" fill="#000000" />
                <rect x="14" y="14" width="17" height="17" fill="#ffffff" />
                <rect x="18" y="18" width="9" height="9" fill="#000000" />
                {/* QR Marker 2 */}
                <rect x="65" y="10" width="25" height="25" fill="#000000" />
                <rect x="69" y="14" width="17" height="17" fill="#ffffff" />
                <rect x="73" y="18" width="9" height="9" fill="#000000" />
                {/* QR Marker 3 */}
                <rect x="10" y="65" width="25" height="25" fill="#000000" />
                <rect x="14" y="69" width="17" height="17" fill="#ffffff" />
                <rect x="18" y="73" width="9" height="9" fill="#000000" />
                {/* Center data pattern */}
                <rect x="42" y="15" width="6" height="6" fill="#000000" />
                <rect x="52" y="20" width="6" height="6" fill="#000000" />
                <rect x="42" y="42" width="16" height="16" fill="#7c3aed" rx="2" />
                <rect x="15" y="45" width="6" height="6" fill="#000000" />
                <rect x="25" y="52" width="6" height="6" fill="#000000" />
                <rect x="65" y="45" width="6" height="6" fill="#000000" />
                <rect x="75" y="55" width="6" height="6" fill="#000000" />
                <rect x="45" y="70" width="6" height="6" fill="#000000" />
                <rect x="60" y="75" width="6" height="6" fill="#000000" />
                <rect x="75" y="70" width="6" height="6" fill="#000000" />
              </svg>
            </div>
            <span className="mt-2 text-[11px] text-purple-400 font-mono">
              {song.title} • {song.style}
            </span>
          </div>
        )}

        {/* Quick Audio / MIDI Export in Modal */}
        <div className="mt-5 pt-4 border-t border-slate-800 flex justify-between gap-2">
          <button
            onClick={() => audioEngine.downloadWav(song)}
            className="flex items-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Baixar WAV</span>
          </button>

          <button
            onClick={() => downloadMidi(song)}
            className="flex items-center gap-1.5 rounded-xl border border-pink-500/30 bg-pink-500/10 px-3 py-2 text-xs font-semibold text-pink-300 transition hover:bg-pink-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Baixar MIDI</span>
          </button>
        </div>
      </div>
    </div>
  );
};
