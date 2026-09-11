import { useEffect, useRef, useState } from 'react';
import { SITE } from '@/config/site';
import { useLiveProof } from '@/hooks/useProof';
import { useReducedMotion } from '@/hooks/useTyping';
import { usePersona, useStore } from '@/store/useStore';
import { CopyAddress } from '../layout/CopyAddress';
import { Card, StatusDot } from '../ui/primitives';
import { HeroIllustration } from './HeroIllustration';

/**
 * Your video (SITE.heroVideo, default /videos/hero.mp4): muted, looping, paused
 * whenever it is off-screen, and never autoplayed under reduced motion.
 * Falls back to the static illustration when the file is missing.
 */
export function HeroMedia() {
  const persona = usePersona();
  const proof = useLiveProof();
  const connected = useStore((s) => s.connected);
  const live = useStore((s) => s.dataSource) === 'live';
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(!SITE.heroVideo);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reduced) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [failed, reduced]);

  // The server-rendered <video> can fail before React attaches onError; check once after hydration.
  useEffect(() => {
    const video = videoRef.current;
    if (video && (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)) setFailed(true);
  }, []);

  const sourceLabel = live ? 'Live' : 'Simulated';

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video w-full bg-[#0b0f14]">
        {failed ? (
          <HeroIllustration persona={persona} jar={proof?.jar ?? 0} />
        ) : (
          <video
            ref={videoRef}
            src={SITE.heroVideo}
            poster={SITE.heroPoster || undefined}
            muted
            loop
            playsInline
            preload="metadata"
            controls={reduced}
            onError={() => setFailed(true)}
            className="size-full object-cover"
            aria-label={`${persona.mascot} feed video`}
          />
        )}

        <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-xs font-medium text-white ring-1 ring-white/15">
          <StatusDot tone={!connected ? 'negative' : live ? 'positive' : 'accent'} />
          {sourceLabel} {persona.mascot} feed
        </div>
        <div className="absolute top-3 right-3 max-w-[60%]">
          <CopyAddress variant="overlay" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted">
        <span className="text-pretty">{persona.heroCaption}</span>
        {failed && process.env.NODE_ENV !== 'production' && <span className="text-subtle">Add your video at public{SITE.heroVideo}</span>}
      </div>
    </Card>
  );
}
