import {useEffect, useState} from 'react';

export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

export function isFinePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 979px)').matches;
}

export function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 979px)');
    const onChange = () => setMobile(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export function useFinePointer(): boolean {
  const [fine, setFine] = useState(isFinePointer);
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onChange = () => setFine(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return fine;
}
