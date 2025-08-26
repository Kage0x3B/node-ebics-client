export function fsKeysStorage(pathToFile: string): FsKeysStorage;
export function tracesStorage(pathToFile: string): TracesStorage;

export interface FsKeysStorage {
	read(): Promise<string>;
	write(data: string): Promise<void>;
}

export interface TracesStorage {
	traceData: string;
	traceLabel: string;
	lastTraceID: string | null;
	connectToLastTrace: boolean;
	label(str: string): TracesStorage;
	data(data: string): TracesStorage;
	ofType(type: string): TracesStorage;
	new (): TracesStorage;
	connect(): TracesStorage;
	persist(): TracesStorage;
	reset(): TracesStorage;
	getTraceName(label: string, type: string, ext: string): string;
	getTracePath(label: string, type: string, ext: string): string;
	getTracePath(label: string, type: string, ext: string): string;
}
