import crypto from 'node:crypto';

import BigNumber from './BigNumber.js';

const MFG_LEN = 32;

const divceil = (a: number, b: number): number => ~~(((a + b) - 1) / b);  
const rjust = (string: string, width: number, padding: string = ' '): string => {
	padding = padding.substr(0, 1);
	if (string.length < width)
		return padding.repeat(width - string.length) + string;
	return string;
};
const xor = (a: Buffer, b: Buffer): Buffer => {
	if (a.length !== b.length)
		throw new Error('Different length for a and b');

	for (let i = 0; i < a.length; i++)
		a[i] = a[i]! ^ b[i]!;  

	return a;
};
const i2osp = (x: number, len: number): Buffer => {
	if (x >= 256 ** len)
		throw new Error('Integer too large');

	return Buffer.from(rjust(new BigNumber(x).toBEBuffer(4).toString().replace(/\x00/gi, ''), len, '\x00')); // eslint-disable-line no-control-regex
};

const generate = (seed: Buffer, masklen: number): Buffer => {
	if (masklen > 4294967296 * MFG_LEN)
		throw new Error('Mask too long');

	const b: Buffer[] = [];

	for (let i = 0; i < divceil(masklen, MFG_LEN); i++)
		b[i] = crypto.createHash('sha256').update(Buffer.concat([seed, i2osp(i, 4)])).digest();

	return (Buffer.concat(b)).slice(0, masklen);
};

export { generate, xor, rjust };

export default { generate, xor, rjust };
