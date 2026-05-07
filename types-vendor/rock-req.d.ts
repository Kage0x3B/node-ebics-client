declare module 'rock-req' {
	import type { Agent as HttpAgent } from 'node:http';
	import type { Agent as HttpsAgent } from 'node:https';

	export interface RockReqOptions {
		method?: string;
		url: string;
		body?: string | Buffer;
		headers?: Record<string, string>;
		agent?: HttpAgent | HttpsAgent;
	}

	export type RockReqCallback = (
		err: Error | null,
		res: { statusCode?: number; headers?: Record<string, string> },
		data: Buffer,
	) => void;

	const rock: (options: RockReqOptions, callback: RockReqCallback) => void;
	export default rock;
}
