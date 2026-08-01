export function loadEnv(path?: string): Record<string, string>;
export function getMultiKeys(env: Record<string, string>, prefix: string): string[];

export function checkWithResult(label: string, url: string, options: RequestInit): Promise<{ ok: boolean; label: string; status?: number; error?: string }>;

export function testTranslateProviders(env: Record<string, string>, options?: { groq?: boolean }): Promise<{ ok: boolean; label: string; status?: number; error?: string }[]>;
export function testTranscribeProviders(env: Record<string, string>): Promise<{ ok: boolean; label: string; status?: number; error?: string }[]>;
