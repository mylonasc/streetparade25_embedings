import {Link, Share2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {buildShareLink, copyToClipboard, SHARE_TEXT, telegramShareUrl, whatsAppShareUrl} from '../share';
import {TelegramIcon, WhatsAppIcon} from './BrandIcons';

export function ShareMenu({link, text}: {link?: string; text?: string}) {
  const shareLink = link ?? buildShareLink();
  const shareText = text ?? SHARE_TEXT;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleCopy(): Promise<void> {
    await copyToClipboard(shareLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="share-menu" ref={rootRef}>
      <button type="button" className="secondary icon-button" aria-label="Share" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Share2 size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className="share-menu-dropdown" role="menu" aria-label="Share options">
          <button type="button" className="share-menu-row" role="menuitem" onClick={() => void handleCopy()}>
            <Link size={20} aria-hidden="true" />
            <span>{copied ? 'Link copied!' : 'Copy link'}</span>
          </button>
          <a className="share-menu-row" role="menuitem" href={telegramShareUrl(shareLink, shareText)} target="_blank" rel="noreferrer noopener">
            <TelegramIcon size={20} aria-hidden="true" />
            <span>Telegram</span>
          </a>
          <a className="share-menu-row" role="menuitem" href={whatsAppShareUrl(shareLink, shareText)} target="_blank" rel="noreferrer noopener">
            <WhatsAppIcon size={20} aria-hidden="true" />
            <span>WhatsApp</span>
          </a>
        </div>
      )}
    </div>
  );
}
