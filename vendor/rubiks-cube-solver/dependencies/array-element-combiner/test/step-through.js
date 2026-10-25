const chalk = require('chalk');
const combiner = require('../');

const options = {
	compare(a, b) {
		return a.compare === b.compare;
	},
	combine(a, b) {
		const aMeta = a.meta || {};
		const bMeta = b.meta || {};
		delete a.meta;
		delete b.meta;

		const dupe = Object.assign({}, a, b);
		dupe.compare = bMeta.newCompare || aMeta.newCompare || dupe.compare;
		dupe.value = a.value + b.value;
		return dupe;
	},
	cancel(value) {
		return value.value === 0;
	},
	ignore(a, b) {
		return b.meta && b.meta.ignore;
	},
	DEBUG: true
};

const input = [
	{ compare: 'yes', value: 1 },
	{ compare: 'yes', value: -1, meta: { ignore: true } },
	{ compare: 'no', value: 10 }
];

const output = combiner(input, options);
console.log(output);
