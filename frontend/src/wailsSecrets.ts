/**
 * Bridge to the OS keychain through the Wails shell bindings.
 *
 * When the app runs inside Wails, integration secrets persist in the system
 * keychain (libsecret / Credential Manager / Keychain). In a plain browser
 * (dev, E2E) there is no shell, and secrets only live in the sidecar's
 * memory for the session; the UI says so.
 */

interface WailsAppBindings {
  SetSecret: (envVar: string, value: string) => Promise<void>;
  GetSecret: (envVar: string) => Promise<string>;
  DeleteSecret: (envVar: string) => Promise<void>;
}

function wailsApp(): WailsAppBindings | null {
  const go = (window as unknown as { go?: { main?: { App?: WailsAppBindings } } }).go;
  return go?.main?.App ?? null;
}

export function hasKeyring(): boolean {
  return wailsApp() !== null;
}

export async function keyringGet(envVar: string): Promise<string | null> {
  const app = wailsApp();
  if (!app) return null;
  try {
    const value = await app.GetSecret(envVar);
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export async function keyringSet(envVar: string, value: string): Promise<boolean> {
  const app = wailsApp();
  if (!app) return false;
  try {
    await app.SetSecret(envVar, value);
    return true;
  } catch {
    return false;
  }
}

export async function keyringDelete(envVar: string): Promise<boolean> {
  const app = wailsApp();
  if (!app) return false;
  try {
    await app.DeleteSecret(envVar);
    return true;
  } catch {
    return false;
  }
}
