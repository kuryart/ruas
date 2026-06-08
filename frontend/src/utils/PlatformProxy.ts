import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { apiClient } from "./ApiClient.ts"

type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;
interface InvokeOptions {
	headers: HeadersInit;
}
type ApiOptions = string;

interface ProxyInvokeOptions {
	args?: InvokeArgs,
	options?: InvokeOptions,
	apiOptions?: ApiOptions
}

// Função para verificar se estamos no ambiente Tauri
export function isTauri(): boolean {
	return typeof window !== "undefined" && (window as any).__TAURI__ !== undefined;
}

// Proxy para a função invoke do Tauri
export async function invoke<T>(cmd: string, invokeOptions: ProxyInvokeOptions = {}): Promise<T | undefined> {
	const { args, options, apiOptions } = invokeOptions;

	if (isTauri()) {
		try {
			return await tauriInvoke<T>(cmd, args, options);
		} catch (error) {
			throw error;
		}
	} else {
		return apiClient.post(cmd, args, apiOptions);
	}
}
