/** Sidecar location, discovered from URL params (browser/E2E) or the Wails shell. */

export interface SidecarTarget {
  url: string;
  token: string;
}

export function useSidecarTarget(): SidecarTarget {
  const params = new URLSearchParams(window.location.search);
  return {
    url: params.get('sidecar') ?? 'http://127.0.0.1:8791',
    token: params.get('token') ?? '',
  };
}
