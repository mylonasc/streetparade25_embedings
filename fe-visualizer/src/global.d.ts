declare global {
  interface SoundCloudWidgetApi {
    play: (callback?: (value?: unknown) => void) => void;
    pause: (callback?: (value?: unknown) => void) => void;
    isPaused: (callback: (paused: boolean) => void) => void;
    bind: (event: string, callback: () => void) => void;
  }

  interface Window {
    SC?: {
      Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidgetApi) & {Events: {READY: string}};
    };
  }
}

export {};
