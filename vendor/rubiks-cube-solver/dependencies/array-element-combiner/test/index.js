const { assert, expect } = require('chai');
const combiner = require('../');

describe('array-element-combiner', () => {
	describe('exporting', () => {
		it('exports a function', () => {
			assert(typeof combiner === 'function');
		});
	});


	describe('input validation', () => {
		it('throws error when not given an array', () => {
			expect(() => combiner()).to.throw()
		});
		it('throws error when not given callbacks', () => {
			expect(() => {
				combiner(['val1', 'val2']);
			}).to.throw();
		});
	});


	describe('functionality', () => {
		let options = {
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
			}
		};

		it('does not modify inputs', () => {
			const input = [{ key: 'value' }];
			expect(combiner(input, options)).to.eql(input);
		});

		it('returns the input if length is 0 or 1', () => {
			let input = [];
			expect(combiner(input, options)).to.eql(input);
			input = ['val1'];
			expect(combiner(input, options)).to.eql(input);
		});

		it('combines two elements', () => {
			const input = [
				{ compare: 'yes', value: 1 },
				{ compare: 'yes', value: 1 }
			];
			const expected = [{ compare: 'yes', value: 2 }];

			expect(combiner(input, options)).to.eql(expected);
		});

		it('does not combine elements that should not be combined', () => {
			const input = [
				{ compare: 'yes', value: 1 },
				{ compare: 'no', value: 1 }
			];
			const expected = input;

			expect(combiner(input, options)).to.eql(expected);
		});

		it('can cancel two elements', () => {
			const input = [
				{ type: '+', value: 1 },
				{ type: '+', value: -1 }
			];
			const expected = [];

			expect(combiner(input, options)).to.eql(expected);
		});

		it('compares correct elements after cancelling', () => {
			const input = [
				{ compare: 'one', value: 10 },
				{ compare: 'two', value: 1 },
				{ compare: 'two', value: -1 },
				{ compare: 'one', value: 10 }
			];
			const expected = [{ compare: 'one', value: 20 }];

			expect(combiner(input, options)).to.eql(expected);
		});

		it('compares correct elements after combining', () => {
			const input = [
				{ compare: 'no', value: null },
				{ compare: 'yes', value: 1 },
				{ compare: 'yes', value: 1 },
				{ compare: 'yes', value: 10 }
			];
			const expected = [
				{ compare: 'no', value: null },
				{ compare: 'yes', value: 12 }
			];

			expect(combiner(input, options)).to.eql(expected);
		});

		describe('ignoring', () => {
			it('ignores elements', () => {
				const input = [
					{ compare: 'yes', value: 1 },
					{ compare: 'yes', value: -1, meta: { ignore: true } }
				];
				const expected = input;

				expect(combiner(input, options)).to.eql(expected);
			});

			it('keeps the correct order', () => {
				const input = [
					{ compare: 'yes', value: 1 },
					{ compare: 'yes', value: -1, meta: { ignore: true } },
					{ compare: 'no', value: 10 }
				];
				const expected = input;

				expect(combiner(input, options)).to.eql(expected);
			});

			it('moves combined element values closer to the beginning of the output', () => {
				const input = [
					{ compare: 'yes', value: 1 },
					{ compare: 'yes', value: -1, meta: { ignore: true } },
					{ compare: 'yes', value: 10 }
				];
				const expected = [
					{ compare: 'yes', value: 11 },
					{ compare: 'yes', value: -1, meta: { ignore: true } }
				];

				expect(combiner(input, options)).to.eql(expected);
			});
		});

		describe('c-c-c-COMBO!', () => {
			it('cancels b then cancels a -- [a, b, b, a]', () => {
				const input = [
					{ compare: 'one', value: -10 },
					{ compare: 'two', value: 1 },
					{ compare: 'two', value: -1 },
					{ compare: 'one', value: 10 }
				];
				const expected = [];

				expect(combiner(input, options)).to.eql(expected);
			});

			it('cancels b then combines a -- [a, b, b, a]', () => {
				const input = [
					{ compare: 'one', value: 10 },
					{ compare: 'two', value: 1 },
					{ compare: 'two', value: -1 },
					{ compare: 'one', value: 10 }
				];
				const expected = [
					{ compare: 'one', value: 20 }
				];

				expect(combiner(input, options)).to.eql(expected);
			});

			it('combines a with value of (combines b) -- [a, b, b]', () => {
				const input = [
					{ compare: 'a', value: 10 },
					{ compare: 'b', value: 1 },
					{ compare: 'b', value: 1, meta: { newCompare: 'a' } },
				];
				const expected = [
					{ compare: 'a', value: 12 }
				];

				expect(combiner(input, options)).to.eql(expected);
			});

			it('combines b with value of (combines a) -- [a, a, b]', () => {
				const input = [
					{ compare: 'one', value: 1 },
					{ compare: 'one', value: 5, meta: { newCompare: 'two' } },
					{ compare: 'two', value: 10 },
				];
				const expected = [
					{ compare: 'two', value: 16 }
				];

				expect(combiner(input, options)).to.eql(expected);
			});

			it('cancels b and combines a -- [a, b, i, b, i, i, a]', () => {
				const input = [
					{ compare: 'a', value: 5 },
					{ compare: 'b', value: -1 },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'b', value: 1 },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'a', value: 5 }
				];
				const expected = [
					{ compare: 'a', value: 10 },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } }
				];

				expect(combiner(input, options)).to.eql(expected);
			});

			it('some edge case stuff -- [i, i, b, a, i, a, b, i]', () => {
				const input = [
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'b', value: -1 },
					{ compare: 'a', value: -5 },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'a', value: 5 },
					{ compare: 'b', value: 1 },
					{ compare: 'i', value: null, meta: { ignore: true } }
				];
				const expected = [
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } },
					{ compare: 'i', value: null, meta: { ignore: true } }
				];

				expect(combiner(input, options)).to.eql(expected);
			});
		});
	});
});
