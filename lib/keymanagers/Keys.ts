import Key from './Key.js';
import type { CertificateOptions } from './Key.js';

type KeyInput = Key | string | string[] | { pem?: string | string[]; mod?: Buffer; exp?: Buffer } | null | undefined;

interface KeysInput {
	A006?: KeyInput;
	E002?: KeyInput;
	X002?: KeyInput;
	bankX002?: KeyInput;
	bankE002?: KeyInput;
}

const keyOrNull = (key: KeyInput): Key | null => {
	if (key instanceof Key)
		return key;

	return key ? new Key({ pem: key as string | string[] }) : null;
};

export default class Keys {
	keys: {
		A006: Key | null;
		E002: Key | null;
		X002: Key | null;
		bankX002: Key | null;
		bankE002: Key | null;
	};

	constructor({
		A006,
		E002,
		X002,
		bankX002,
		bankE002,
	}: KeysInput) {
		this.keys = {
			A006: keyOrNull(A006),
			E002: keyOrNull(E002),
			X002: keyOrNull(X002),
			bankX002: keyOrNull(bankX002),
			bankE002: keyOrNull(bankE002),
		};
	}

	static generate(
		certificateOptions?: CertificateOptions,
		whichKeys: Array<'A006' | 'E002' | 'X002' | 'bankE002' | 'bankX002'> = ['A006', 'E002', 'X002'],
	): Keys {
		const keys: KeysInput = {};

		whichKeys.forEach((key) => {
			keys[key] = Key.generate(undefined, certificateOptions);
		});

		return new Keys(keys);
	}

	setKeys(keys: KeysInput): void {
		if (keys.A006) this.keys.A006 = new Key(keys.A006 as ConstructorParameters<typeof Key>[0]);
		if (keys.E002) this.keys.E002 = new Key(keys.E002 as ConstructorParameters<typeof Key>[0]);
		if (keys.X002) this.keys.X002 = new Key(keys.X002 as ConstructorParameters<typeof Key>[0]);
		if (keys.bankX002) this.keys.bankX002 = new Key(keys.bankX002 as ConstructorParameters<typeof Key>[0]);
		if (keys.bankE002) this.keys.bankE002 = new Key(keys.bankE002 as ConstructorParameters<typeof Key>[0]);
	}

	setBankKeys(bankKeys: KeysInput): void {
		this.setKeys(bankKeys);
	}

	a(): Key | null {
		return this.keys.A006;
	}

	e(): Key | null {
		return this.keys.E002;
	}

	x(): Key | null {
		return this.keys.X002;
	}

	bankX(): Key | null {
		return this.keys.bankX002;
	}

	bankE(): Key | null {
		return this.keys.bankE002;
	}
}
