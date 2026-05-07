'use strict';

const genericUpload = require('./generic-upload');

module.exports = (document, options) => genericUpload(document, {
	serviceName: 'SDD',
	msgName: 'pain.008',
	...options,
});
