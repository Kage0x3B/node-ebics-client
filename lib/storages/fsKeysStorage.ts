import fs from 'node:fs';

export interface FsKeysStorage {
	read(): Promise<string>;
	write(data: string): Promise<void>;
}

const fsKeysStorage = (pathToFile: string): FsKeysStorage => {
	const path = pathToFile;

	return {
		write(data: string): Promise<void> {
			return new Promise((resolve, reject) => {
				fs.writeFile(path, data, { encoding: 'utf8' }, (error) => {
					if (error) reject(error);

					return resolve();
				});
			});
		},

		read(): Promise<string> {
			return new Promise((resolve, reject) => {
				fs.readFile(path, { encoding: 'utf8' }, (error, data) => {
					if (error) reject(error);

					return resolve(data);
				});
			});
		},
	};
};

export default fsKeysStorage;
