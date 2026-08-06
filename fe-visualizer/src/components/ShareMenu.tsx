import {Link, Share2} from 'lucide-react';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {buildShareLink, copyToClipboard, SHARE_TEXT, telegramShareUrl, whatsAppShareUrl} from '../share';
import {TelegramIcon, WhatsAppIcon} from './BrandIcons';

export type SharedMenuPayload = {
  link: string;
  text: string;
};

export function ShareMenu({link, text, onPrepare}: {
  link?: string;
  text?: string;
  onPrepare?: () => Promise<SharedMenuPayload>;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prepared, setPrepared] = useState<SharedMenuPayload | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [openLeft, setOpenLeft] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onPrepareRef = useRef(onPrepare);
  useEffect(() => { onPrepareRef.current = onPrepare; }, [onPrepare]);

  const shareLink = prepared?.link ?? link ?? buildShareLink();
  const shareText = prepared?.text ?? text ?? SHARE_TEXT;

  useLayoutEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fitsRight = window.innerWidth - rect.left >= 220;
    const fitsLeft = rect.right >= 220;
    if (!fitsRight) setOpenLeft(false);
    else if (!fitsLeft) setOpenLeft(true);
    else setOpenLeft(window.innerWidth - rect.right >= rect.left);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPrepared(null);
    setPrepareError('');
    setPreparing(false);
    const prepare = onPrepareRef.current;
    if (!prepare) return;
    let cancelled = false;
    setPreparing(true);
    prepare().then((payload) => {
      if (cancelled) return;
      setPrepared(payload);
    }).catch((err: unknown) => {
      if (!cancelled) setPrepareError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!cancelled) setPreparing(false);
    });
    return () => { cancelled = true; };
  }, [open, retryKey]);

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
    if (preparing) return;
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
        <div className={`share-menu-dropdown ${openLeft ? 'align-left' : 'align-right'}`} role="menu" aria-label="Share options">
          {prepareError && (
            <p className="share-menu-error">
              {prepareError}
              {onPrepare && <button type="button" className="share-menu-retry" onClick={() => setRetryKey((value) => value + 1)}>Retry</button>}
            </p>
          )}
          <button type="button" className="share-menu-row" role="menuitem" disabled={preparing} onClick={() => void handleCopy()}>
            <Link size={20} aria-hidden="true" />
            <span>{copied ? 'Link copied!' : 'Copy link'}</span>
          </button>
          <a className="share-menu-row" role="menuitem" aria-disabled={preparing} href={telegramShareUrl(shareLink, shareText)} target="_blank" rel="noreferrer noopener" onClick={(event) => { if (preparing) event.preventDefault(); }}>
            <TelegramIcon size={20} aria-hidden="true" />
            <span>Telegram</span>
          </a>
          <a className="share-menu-row" role="menuitem" aria-disabled={preparing} href={whatsAppShareUrl(shareLink, shareText)} target="_blank" rel="noreferrer noopener" onClick={(event) => { if (preparing) event.preventDefault(); }}>
            <WhatsAppIcon size={20} aria-hidden="true" />
            <span>WhatsApp</span>
          </a>
          {preparing && <p className="share-menu-hint">Preparing share…</p>}
        </div>
      )}
    </div>
  );
}
