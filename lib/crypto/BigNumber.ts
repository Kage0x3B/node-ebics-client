import forge from 'node-forge';

const { jsbn: { BigInteger } } = forge;

// node-forge's BigInteger has more methods at runtime than its types expose.
type ForgeBigInteger = InstanceType<typeof BigInteger> & {
	fromInt(n: number): void;
	fromString(s: string, radix?: number): void;
};

type BigNumberInput = number | string | Buffer | number[] | BigNumber | InstanceType<typeof BigInteger>;

class BigNumber {
	_n: ForgeBigInteger;

	constructor(value: BigNumberInput, radix: number = 10) {
		if (value === null || value === undefined)
			throw new Error('value is missing.');

		this._n = new BigInteger(null) as ForgeBigInteger;

		if (value instanceof BigNumber)
			this._n = value._n;
		else if (value instanceof BigInteger)
			this._n = value as ForgeBigInteger;
		else if (typeof value === 'number')
			this._n.fromInt(value);
		else if (typeof value === 'string')
			this._n.fromString(value, radix);
		else if (Buffer.isBuffer(value))
			this._n.fromString(value.toString('hex'), 16);
		else if (Array.isArray(value))
			this._n.fromString(Buffer.from(value).toString('hex'), 16);
		else
			throw new TypeError('Unsupported value type.');
	}

	toBEBuffer(length?: number): Buffer {
		const arr = this._n.toByteArray();
		if (length === undefined)
			return Buffer.from(arr);

		if (arr.length > length)
			throw new Error('Number out of range.');

		while (arr.length < length)
			arr.unshift(0);

		return Buffer.from(arr);
	}

	toString(radix: number = 10): string {
		const result = this._n.toString(radix);
		if (radix === 16)
			return result.padStart(2, '0');
		return result;
	}

	and(num: BigNumberInput): BigNumber {
		return new BigNumber(this._n.and(new BigNumber(num)._n));
	}

	mul(num: BigNumberInput): BigNumber {
		return new BigNumber(this._n.multiply(new BigNumber(num)._n));
	}

	mod(num: BigNumberInput): BigNumber {
		return new BigNumber(this._n.mod(new BigNumber(num)._n));
	}

	shrn(num: BigNumberInput): BigNumber {
		return new BigNumber(this._n.shiftRight(new BigNumber(num)._n as unknown as number));
	}
}

export default BigNumber;
