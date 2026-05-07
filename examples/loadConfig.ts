import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const safeLoadJson = (file: string | null): Record<string, unknown> => {
	if (!file)
		return {};

	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		console.warn(`Couldn't load ${file} config file.`);
		return {};
	}
};

const getDefaultEnv = (): string | undefined => {
	const [, , parArg] = process.argv;
	return parArg || process.env.NODE_ENV;
};

const getBankIdentifier = (): string => {
	const [, , , parArg] = process.argv;
	return parArg || 'testbank';
};

const getEntityIdentifier = (): string => {
	const [, , , , parArg] = process.argv;
	return parArg || '';
};

const loadConfig = (
	configDirectory: string = path.join(__dirname, './config'),
	env: string | undefined = getDefaultEnv(),
	bank: string = getBankIdentifier(),
	entity: string = getEntityIdentifier(),
): Record<string, unknown> => {
	entity ? console.log(`Loading config from ${configDirectory} with env set to ${env}, bank set to ${bank} and entity set to ${entity}.`) : console.log(`Loading config from ${configDirectory} with env set to ${env} and bank set to ${bank}.`);

	(globalThis as Record<string, unknown>).entity = entity;
	const baseConfigFile = path.join(configDirectory, 'config.json');
	const envConfigFile = env ? entity ? path.join(configDirectory, `config.${env}.${bank}.${entity}.json`) : path.join(configDirectory, `config.${env}.${bank}.json`) : null;

	return {
		...safeLoadJson(baseConfigFile),
		...safeLoadJson(envConfigFile),
	};
};

export default loadConfig;
