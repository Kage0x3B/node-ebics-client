import fs from 'node:fs';

import { v1 as uuidv1 } from 'uuid';

export interface TracesStorage {
	traceData: string;
	traceLabel: string;
	type?: string;
	lastTraceID: string | null;
	connectToLastTrace: boolean;
	label(str: string): TracesStorage;
	data(data: string): TracesStorage;
	ofType(type: string): TracesStorage;
	'new'(): TracesStorage;
	connect(): TracesStorage;
	persist(): void;
}

const traceName = (uuid: string, label: string, type: string, ext: string = 'xml'): string =>
	`${uuid}_${label}_${type}.${ext}`;

const tracesStorage = (dir: string): TracesStorage => ({
	traceData: '',
	traceLabel: '',
	lastTraceID: null,
	connectToLastTrace: false,

	label(str: string) {
		this.traceLabel = str;

		return this;
	},

	data(data: string) {
		if (!data)
			throw Error('No trace given to be persisted.');

		this.traceData = data;

		return this;
	},

	ofType(type: string) {
		this.type = type;

		return this;
	},

	new() {
		this.connectToLastTrace = false;

		return this;
	},

	connect() {
		this.connectToLastTrace = true;

		return this;
	},

	persist() {
		if (!dir)
			throw Error('No directory to save the traces to provided.');

		this.lastTraceID = this.connectToLastTrace ? this.lastTraceID : uuidv1();

		const name = traceName(this.lastTraceID!, this.traceLabel, this.type ?? '');
		const path = `${dir}/${name}`;

		try {
			fs.writeFileSync(path, this.traceData);
		} catch (error) {
			throw error;
		}
	},
});

export default tracesStorage;
