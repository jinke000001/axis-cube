// Project adapter for the combiner's optional, undeclared terminal debug helper.
// Browser solving never enables DEBUG; keep even that path free of Node modules.
const plain = (text) => text;
plain.bold = plain;
plain.green = plain;
export default plain;
