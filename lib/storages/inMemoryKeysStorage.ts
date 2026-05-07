import type { FsKeysStorage } from './fsKeysStorage.js';

const inMemoryKeysStorage = (): FsKeysStorage => {
	let storedData: string | undefined;

	return {
		write(data: string): Promise<void> {
			return new Promise((resolve) => {
				storedData = data;
				return resolve();
			});
		},

		read(): Promise<string> {
			return new Promise((resolve) => {
				return resolve(storedData as string);
			});
		},
	};
};

export default inMemoryKeysStorage;
