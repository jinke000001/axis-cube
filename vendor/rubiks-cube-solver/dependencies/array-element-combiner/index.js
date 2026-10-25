const Combiner = require('./Combiner');

/**
 * Given an array, combines adjacent elements. Callbacks that indicate if two
 * elements can be combined and what the combined value is must be given. When
 * two elements are combined, both elements are removed from the output array
 * and in their place is the combined value. If the combined value is undefined
 * then both elements are removed and nothing is inserted in their place. When
 * the combined value is inserted, the following elements will be compared with
 * the combined value and not the original element.
 *
 * @param {array} array - The input array.
 * @param {object} options - Options.
 * @param {function} [options.cancel] - Returns a boolean indicating whether two elements should be cancelled (and no value is inserted).
 * @param {function} options.combine - Returns the combined value of two elements.
 * @param {function} options.compare - Returns a boolean indicating whether two elements can be combined.
 * @param {function} [options.ignore] - Returns a boolean indicating whether to ignore an element and continue with the next.
 */
module.exports = (input, options = {}) => {
	validateInput(input, options);

	const combiner = new Combiner(input, options);
	return combiner.run();
};


//=======================================================
// Helper functions
//=======================================================
function validateInput(input, options) {
	if (!input) {
		throw new Error(`Why are you even importing this.`);
	}

	if (!options.compare) {
		throw new Error(`options.compare callback must be present`);
	}

	if (!options.combine) {
		throw new Error(`options.combine callback must be present`);
	}
}
