import pkg from '../package.json' with { type: 'json' };

const name = 'Node Ebics Client';
const orderOperations = {
	ini: 'INI',
	upload: 'UPLOAD',
	download: 'DOWNLOAD',
} as const;

const version: string = pkg.version;
const productString = `${name} ${version}`;

export { name, version, orderOperations, productString };

export default {
	name,
	version,
	orderOperations,
	productString,
};
