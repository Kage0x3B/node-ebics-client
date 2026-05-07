'use strict';

const genericUpload = require('./generic-upload');

module.exports = (document, options) => genericUpload(document, {
	serviceName: 'SCT',
	msgName: 'pain.001',
	...options,
});
