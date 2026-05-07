type DateInput = string | number | Date;

const prefixNumber = (n: number): string => {
	if (n < 10)
		return `0${n}`;
	return n.toString();
};

const date = {
	getDateObject(d: DateInput = Date.now()): Date {
		const dateObject = new Date(d);
		 
		if (isNaN(dateObject.getTime()))
			throw new Error(`${String(d)} is invalid date.`);
		return dateObject;
	},
	toISODate(d: DateInput = Date.now(), utc = true): string {
		const t = date.getDateObject(d);
		if (utc)
			return `${t.getUTCFullYear()}-${prefixNumber(t.getUTCMonth() + 1)}-${prefixNumber(t.getUTCDate())}`;
		return `${t.getFullYear()}-${prefixNumber(t.getMonth() + 1)}-${prefixNumber(t.getDate())}`;
	},
	toISOTime(d: DateInput = Date.now(), utc = true): string {
		const t = date.getDateObject(d);
		if (utc)
			return `${prefixNumber(t.getUTCHours())}:${prefixNumber(t.getUTCMinutes())}:${prefixNumber(t.getUTCSeconds())}`;
		return `${prefixNumber(t.getHours())}:${prefixNumber(t.getMinutes())}:${prefixNumber(t.getSeconds())}`;
	},
};

const dateRange = (start?: DateInput, end?: DateInput) => {
	if (start && end)
		return {
			DateRange: {
				Start: date.toISODate(start),
				End: date.toISODate(end),
			},
		};

	return {};
};

const removeUndefinedProperties = <T>(obj: T): T => {
	if (Array.isArray(obj)) {
		obj.map(item => removeUndefinedProperties(item));
		return obj;
	}

	if (obj && typeof obj === 'object')
		Object.keys(obj as Record<string, unknown>).forEach((key) => {
			const o = obj as Record<string, unknown>;
			if (o[key] === undefined) delete o[key];
			else if (typeof o[key] === 'object') removeUndefinedProperties(o[key]);
		});

	return obj;
};

export { dateRange, date, removeUndefinedProperties };

export default {
	dateRange,
	date,
	removeUndefinedProperties,
};
