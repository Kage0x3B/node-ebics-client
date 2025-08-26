'use strict';

const genericDownload = require('./generic-download');

module.exports = options => genericDownload({
	serviceName: 'PSR',
	msgName: 'pain.002',
	...options,
});
