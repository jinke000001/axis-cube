/*! Pinned CFOP vendor bundle. See README.md and provenance.json.
MIT License

Copyright (c) Scott McKenzie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


Copyright (c) 2013 Brandon Jones, Colin MacKenzie IV

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

 1. The origin of this software must not be misrepresented you must not
    claim that you wrote the original software. If you use this software
    in a product, an acknowledgment in the product documentation would be
    appreciated but is not required.

 2. Altered source versions must be plainly marked as such, and must not
    be misrepresented as being the original software.

 3. This notice may not be removed or altered from any source distribution.

MIT License

Copyright (c) Scott McKenzie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dependencies/gl-vec3/fromValues.js
var require_fromValues = __commonJS({
  "dependencies/gl-vec3/fromValues.js"(exports, module) {
    "use strict";
    module.exports = fromValues;
    function fromValues(x, y, z) {
      var out = new Float32Array(3);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    }
  }
});

// dependencies/gl-vec3/normalize.js
var require_normalize = __commonJS({
  "dependencies/gl-vec3/normalize.js"(exports, module) {
    "use strict";
    module.exports = normalize;
    function normalize(out, a) {
      var x = a[0], y = a[1], z = a[2];
      var len = x * x + y * y + z * z;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
      }
      return out;
    }
  }
});

// dependencies/gl-vec3/dot.js
var require_dot = __commonJS({
  "dependencies/gl-vec3/dot.js"(exports, module) {
    "use strict";
    module.exports = dot;
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
  }
});

// dependencies/gl-vec3/angle.js
var require_angle = __commonJS({
  "dependencies/gl-vec3/angle.js"(exports, module) {
    "use strict";
    module.exports = angle2;
    var fromValues = require_fromValues();
    var normalize = require_normalize();
    var dot = require_dot();
    function angle2(a, b) {
      var tempA = fromValues(a[0], a[1], a[2]);
      var tempB = fromValues(b[0], b[1], b[2]);
      normalize(tempA, tempA);
      normalize(tempB, tempB);
      var cosine = dot(tempA, tempB);
      if (cosine > 1) {
        return 0;
      } else {
        return Math.acos(cosine);
      }
    }
  }
});

// dependencies/gl-vec3/cross.js
var require_cross = __commonJS({
  "dependencies/gl-vec3/cross.js"(exports, module) {
    "use strict";
    module.exports = cross3;
    function cross3(out, a, b) {
      var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    }
  }
});

// dependencies/gl-vec3/rotateX.js
var require_rotateX = __commonJS({
  "dependencies/gl-vec3/rotateX.js"(exports, module) {
    "use strict";
    module.exports = rotateX2;
    function rotateX2(out, a, b, c) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0];
      r[1] = p[1] * Math.cos(c) - p[2] * Math.sin(c);
      r[2] = p[1] * Math.sin(c) + p[2] * Math.cos(c);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
  }
});

// dependencies/gl-vec3/rotateY.js
var require_rotateY = __commonJS({
  "dependencies/gl-vec3/rotateY.js"(exports, module) {
    "use strict";
    module.exports = rotateY2;
    function rotateY2(out, a, b, c) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[2] * Math.sin(c) + p[0] * Math.cos(c);
      r[1] = p[1];
      r[2] = p[2] * Math.cos(c) - p[0] * Math.sin(c);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
  }
});

// dependencies/gl-vec3/rotateZ.js
var require_rotateZ = __commonJS({
  "dependencies/gl-vec3/rotateZ.js"(exports, module) {
    "use strict";
    module.exports = rotateZ2;
    function rotateZ2(out, a, b, c) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0] * Math.cos(c) - p[1] * Math.sin(c);
      r[1] = p[0] * Math.sin(c) + p[1] * Math.cos(c);
      r[2] = p[2];
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
  }
});

// debug-colors.js
var debug_colors_exports = {};
__export(debug_colors_exports, {
  default: () => debug_colors_default
});
var plain, debug_colors_default;
var init_debug_colors = __esm({
  "debug-colors.js"() {
    "use strict";
    plain = (text) => text;
    plain.bold = plain;
    plain.green = plain;
    debug_colors_default = plain;
  }
});

// dependencies/array-element-combiner/Combiner.js
var require_Combiner = __commonJS({
  "dependencies/array-element-combiner/Combiner.js"(exports, module) {
    "use strict";
    var chalk;
    var DEBUG;
    var DEFAULTS = {
      cancel() {
        return false;
      },
      ignore() {
        return false;
      }
    };
    var Combiner = class {
      constructor(input, options) {
        this.options = Object.assign({}, DEFAULTS, options);
        if (this.options.DEBUG) {
          chalk = (init_debug_colors(), __toCommonJS(debug_colors_exports));
          DEBUG = options.DEBUG;
        }
        this.input = input.slice();
        this.output = [];
      }
      run() {
        if (this.input.length <= 1) {
          return this.input;
        }
        this.temp = [this.input.shift()];
        let action, actionValue, tempSnapshot;
        while (this.temp.length > 0) {
          debug(() => {
            console.log(chalk.bold("========= START ========="));
            this._logInfo();
            console.log();
          });
          let notIgnoredIdx, notIgnoredEl;
          if (this.temp.length === 1) {
            notIgnoredIdx = 0;
            notIgnoredEl = this.input[notIgnoredIdx];
            while (notIgnoredIdx < this.input.length && this.options.ignore(this.temp[0], notIgnoredEl)) {
              notIgnoredEl = this.input[++notIgnoredIdx];
            }
            if (notIgnoredIdx < this.input.length) {
              this.temp.push(notIgnoredEl);
            }
          }
          debug(() => tempSnapshot = this.temp.slice());
          if (this.temp.length === 0) {
            debug(() => {
              console.log(chalk.green("breaking"));
              console.log(chalk.bold("========= END ========="));
              console.log();
            });
            break;
          }
          if (this.temp.length === 1) {
            this.output.push(this.temp.pop());
            this.populateTempForward();
            debug(() => {
              console.log(chalk.green("continuing"));
              this._logInfo();
              console.log(chalk.bold("========= END ========="));
              console.log();
            });
            continue;
          }
          if (this.options.compare(this.temp[0], this.temp[1])) {
            if (notIgnoredIdx !== void 0) {
              this.input.splice(notIgnoredIdx, 1);
            }
            const value = this.options.combine(this.temp[0], this.temp[1]);
            debug(() => {
              action = "Combining:";
              actionValue = value;
            });
            this.temp = this.options.cancel(value) ? [] : [value];
            this.populateTempBackward();
            if (this.temp.length === 0) {
              this.populateTempForward();
            }
          } else {
            this.output.push(this.temp.shift());
            if (notIgnoredIdx !== void 0) {
              if (notIgnoredIdx > 0) {
                this.temp = this.input.splice(0, 1);
              } else {
                this.input.splice(notIgnoredIdx, 1);
              }
            }
            debug(() => action = "Skipping:");
          }
          debug(() => {
            console.log(chalk.green(action), tempSnapshot);
            console.log(chalk.green("value:"), actionValue);
            console.log();
            this._logInfo();
            console.log(chalk.bold("========= END ========="));
            console.log();
            action = null;
            actionValue = null;
            tempSnapshot = null;
          });
        }
        debug(() => {
          console.log(chalk.bold.green("========= FINAL ========="));
          this._logInfo();
          console.log(chalk.bold.green("========= FINAL ========="));
          console.log();
        });
        return this.output;
      }
      populateTempBackward() {
        if (this.output.length > 0) {
          this.temp.unshift(this.output.pop());
        }
      }
      populateTempForward() {
        if (this.input.length > 0) {
          this.temp.push(this.input.shift());
        }
      }
      _logInfo() {
        console.log(chalk.bold("output"), this.output);
        console.log(chalk.bold("temp"), this.temp);
        console.log(chalk.bold("input"), this.input);
      }
    };
    module.exports = Combiner;
    function debug(callback) {
      if (!DEBUG) {
        return;
      }
      callback && callback();
    }
  }
});

// dependencies/array-element-combiner/index.js
var require_array_element_combiner = __commonJS({
  "dependencies/array-element-combiner/index.js"(exports, module) {
    "use strict";
    var Combiner = require_Combiner();
    module.exports = (input, options = {}) => {
      validateInput(input, options);
      const combiner2 = new Combiner(input, options);
      return combiner2.run();
    };
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
  }
});

// upstream/src/models/Vector.js
var import_angle = __toESM(require_angle());
var import_cross = __toESM(require_cross());
var import_rotateX = __toESM(require_rotateX());
var import_rotateY = __toESM(require_rotateY());
var import_rotateZ = __toESM(require_rotateZ());
var rotate = {
  x: import_rotateX.default,
  y: import_rotateY.default,
  z: import_rotateZ.default
};
var Vector = class _Vector {
  /**
   * Factory method.
   * @param {string} vector - Space-deliminated x, y, and z values.
   * @return {Vector}
   */
  static FromString(vector) {
    return new _Vector(vector.split(" ").map((value) => parseInt(value)));
  }
  /**
   * @param {array} vector1 - Vector 1.
   * @param {array} vector2 - Vector 2.
   * @return {boolean}
   */
  static areEqual(vector1, vector2) {
    return vector1[0] === vector2[0] && vector1[1] === vector2[1] && vector1[2] === vector2[2];
  }
  /**
   * Helper method. gl-vec3's angle function always returns positive but in many
   * cases we want the angle in the direction from one vector to another. To get
   * the sign of the angle, cross the two vectors and determine the direction the
   * crossed vector, um, directs in. For example, the vector [0, -1, 0] would
   * shoot negatively along the y-axis.
   *
   * @param {array} v1 - Vector 1.
   * @param {array} v2 - Vector 2.
   * @return {number}
   */
  static getAngle(v1, v2) {
    let _angle = (0, import_angle.default)(v1, v2);
    let crossVector = (0, import_cross.default)([], v1, v2);
    let sign = new _Vector(crossVector).getMagnitude();
    return sign ? _angle * sign : _angle;
  }
  /**
   * Finds the rotation axis and angle to get from one normal to another.
   * @param {array} normal1 - The from normal.
   * @param {array} normal2 - The to normal.
   * @return {object} - Stores the rotation axis and angle
   */
  static getRotationFromNormals(normal1, normal2) {
    let axis = new _Vector((0, import_cross.default)([], normal1, normal2)).getAxis();
    let angle2 = _Vector.getAngle(normal1, normal2);
    if (!axis) {
      let axes = ["x", "y", "z"];
      axes.splice(axes.indexOf(new _Vector(normal1).getAxis()), 1);
      axis = axes[0];
    }
    return { axis, angle: angle2 };
  }
  /**
   * @param {object} rotation - The rotation to reverse.
   * @return {object}
   */
  static reverseRotation(rotation) {
    rotation.angle *= -1;
    return rotation;
  }
  /**
   * @param {array} [vector] - Contains x, y, and z values.
   */
  constructor(vector) {
    this.set(vector);
  }
  /**
   * @return {array}
   */
  toArray() {
    return this.vector;
  }
  /**
   * @param {array} vector - The new vector to store.
   */
  set(vector) {
    if (typeof vector === "undefined") {
      return;
    }
    this.vector = vector.map((value) => Math.round(value));
  }
  /**
   * @param {number} value - The value to store.
   */
  setX(value) {
    this.vector[0] = value;
  }
  /**
   * @param {number} value - The value to store.
   */
  setY(value) {
    this.vector[1] = value;
  }
  /**
   * @param {number} value - The value to store.
   */
  setZ(value) {
    this.vector[2] = value;
  }
  /**
   * @return {number}
   */
  getX() {
    return this.toArray()[0];
  }
  /**
   * @return {number}
   */
  getY() {
    return this.toArray()[1];
  }
  /**
   * @return {number}
   */
  getZ() {
    return this.toArray()[2];
  }
  /**
   * Kind of a flimsy method. If this vector points parallel to an axis, this
   * returns true. A hacky way to find this is to count the number of 0's and
   * return true if and only if the count is 2.
   * @return {boolean}
   */
  isAxis() {
    let count = 0;
    for (let value of this.vector) {
      if (value === 0) {
        count += 1;
      }
    }
    return count === 2;
  }
  /**
   * Kind of a flimsy method. If this vector points parallel to an axis, return
   * that axis.
   * @return {string}
   */
  getAxis() {
    if (!this.isAxis()) {
      return;
    }
    if (this.vector[0] !== 0) return "x";
    if (this.vector[1] !== 0) return "y";
    if (this.vector[2] !== 0) return "z";
  }
  /**
   * Kind of a flimsy method. If this vector points parallel to an axis, return
   * the magnitude of the value along that axis. (Basically, return whether it
   * is positive or negative.)
   * @return {number}
   */
  getMagnitude() {
    if (!this.isAxis()) {
      return;
    }
    return this[`get${this.getAxis().toUpperCase()}`]();
  }
  /**
   * @param {string} axis - The axis to rotate around.
   * @param {number} angle - The angle of rotation.
   * @return {Vector}
   */
  rotate(axis, angle2) {
    axis = axis.toLowerCase();
    this.set(rotate[axis]([], this.vector, [0, 0, 0], angle2));
    return this;
  }
};

// upstream/src/models/Face.js
var faceToNormal = {
  front: "0 0 1",
  right: "1 0 0",
  up: "0 1 0",
  down: "0 -1 0",
  left: "-1 0 0",
  back: "0 0 -1"
};
var Face = class _Face {
  /**
   * Factory method.
   * @param {string|array} normal - The normal that identifies this face.
   * @return {Face}
   */
  static FromNormal(normal) {
    if (typeof normal === "string") {
      normal = Vector.FromString(normal).toArray();
    }
    return new _Face(_Face.getFace(normal));
  }
  /**
   * @param {string} face - A string that identifies a face.
   * @return {array}
   */
  static getNormal(face) {
    return Vector.FromString(faceToNormal[face]).toArray();
  }
  /**
   * @param {string|array} normal - The normal that identifies a face.
   * @return {string}
   */
  static getFace(normal) {
    if (typeof normal === "string") {
      normal = Vector.FromString(normal).toArray();
    }
    for (let face of Object.keys(faceToNormal)) {
      if (normal.join(" ") === faceToNormal[face]) {
        return face;
      }
    }
  }
  /**
   * @param {string} face - The string of a face, e.g. 'RIGHT'.
   */
  constructor(face) {
    if (typeof face !== "string") {
      throw new Error(`"face" must be a string (received: ${face})`);
    }
    face = face.toLowerCase();
    this.vector = Vector.FromString(faceToNormal[face]);
  }
  /**
   * Method to return the normal as an array.
   * @return {array}
   */
  normal() {
    return this.vector.toArray();
  }
  /**
   * @return {string}
   */
  toString() {
    return _Face.getFace(this.normal());
  }
  /**
   * Simulates an orientation change where this face becomes the new given face.
   * NOTE: this only changes this face's normals, not any cubies' positions.
   * @param {string|Face} face - The new face, e.g. 'FRONT'
   */
  orientTo(newFace) {
    if (typeof newFace === "string") {
      newFace = new _Face(newFace);
    }
    let { axis, angle: angle2 } = Vector.getRotationFromNormals(this.normal(), newFace.normal());
    this.vector.rotate(axis, angle2);
    return this;
  }
  /**
   * Convenience method for rotating this face. NOTE: this only changes this
   * face's normals, not any cubies' positions.
   * @param {string} axis - Axis of rotation.
   * @param {number} angle - Angle of rotation.
   * @return {Face}
   */
  rotate(axis, angle2) {
    this.vector.rotate(axis, angle2);
    return this;
  }
};
Face.FRONT = new Face("FRONT");
Face.RIGHT = new Face("RIGHT");
Face.UP = new Face("UP");
Face.DOWN = new Face("DOWN");
Face.LEFT = new Face("LEFT");
Face.BACK = new Face("BACK");

// upstream/src/models/Cubie.js
var Cubie = class _Cubie {
  /**
   * Factory method. Returns an instance of a cubie identified by the faces it
   * sits on.
   * @param {array} faces - A list of all the faces this cubie sits on.
   */
  static FromFaces(faces) {
    let position = new Vector([0, 0, 0]);
    let colorMap = {};
    for (let face of faces) {
      if (!face) {
        continue;
      }
      let temp = new Face(face);
      let axis = temp.vector.getAxis().toUpperCase();
      position[`set${axis}`](temp.vector.getMagnitude());
      colorMap[face.toLowerCase()] = temp.toString()[0].toLowerCase();
    }
    return new _Cubie({ position: position.toArray(), colorMap });
  }
  /**
   * @param {object} [options]
   * @param {object} options.position - The cubie's position.
   * @param {object} options.colorMap - A map with faces as keys and colors
   * as values. For example: { 'front' : 'f' }.
   */
  constructor({ position, colorMap = {} }) {
    this.position(position);
    this.colorMap = {};
    Object.keys(colorMap).forEach((face) => {
      let color = colorMap[face];
      this.colorFace(face, color);
    });
  }
  /**
   * @return {Cubie}
   */
  clone() {
    return new _Cubie({
      position: this.position(),
      colorMap: this.colorMap
    });
  }
  /**
   * Getter/setter for the vector position.
   * @param {array} [position] - The new position to store.
   * @return {array}
   */
  position(position) {
    if (typeof position === "undefined") {
      return this.vector ? this.vector.toArray() : this.vector;
    }
    this.vector = new Vector(position);
  }
  /**
   * @return {number}
   */
  getX() {
    return this.vector.getX();
  }
  /**
   * @return {number}
   */
  getY() {
    return this.vector.getY();
  }
  /**
   * @return {number}
   */
  getZ() {
    return this.vector.getZ();
  }
  /**
   * @return {boolean}
   */
  isCorner() {
    return Object.keys(this.colorMap).length === 3;
  }
  /**
   * @return {boolean}
   */
  isEdge() {
    return Object.keys(this.colorMap).length === 2;
  }
  /**
   * @return {boolean}
   */
  isMiddle() {
    return Object.keys(this.colorMap).length === 1;
  }
  /**
   * @return {array}
   */
  colors() {
    return Object.keys(this.colorMap).map((face) => this.colorMap[face]);
  }
  /**
   * @param {string} color - Check if the cubie has this color.
   * @return {boolean}
   */
  hasColor(color) {
    color = color.toLowerCase();
    for (let face of Object.keys(this.colorMap)) {
      if (this.colorMap[face] === color) {
        return true;
      }
    }
    return false;
  }
  /**
   * @param {string} face - Check if the cubie has this face.
   * @return {boolean}
   */
  hasFace(face) {
    face = face.toLowerCase();
    return Object.keys(this.colorMap).includes(face);
  }
  /**
   * Sets a color on a given face or normal of a cubie.
   * @param {string} face - The face of the cubie we want to set the color on.
   * @param {string} color - The color we want to set.
   * @return {Cubie}
   */
  colorFace(face, color) {
    face = face.toLowerCase();
    color = color.toLowerCase();
    this.colorMap[face] = color;
    return this;
  }
  /**
   * @param {string} face - The color on the face this cubie sits on.
   * @return {string}
   */
  getColorOfFace(face) {
    face = face.toLowerCase();
    return this.colorMap[face];
  }
  /**
   * @param {string} color - Find the face that this color sits on.
   * @return {string}
   */
  getFaceOfColor(color) {
    color = color.toLowerCase();
    return Object.keys(this.colorMap).find((cubieColor) => {
      return this.colorMap[cubieColor] === color;
    });
  }
  /**
   * Return all the faces this cubie sits on.
   * @return {array}
   */
  faces() {
    return Object.keys(this.colorMap);
  }
  /**
   * Rotates the position vector around `axis` by `angle`. Updates the internal
   * position vector and the normal-color map.
   * @param {string} axis - The axis of rotation.
   * @param {number} angle - The magnitude of rotation.
   * @return {null}
   */
  rotate(axis, angle2) {
    this.vector.rotate(axis, angle2);
    let newMap = {};
    for (let face of Object.keys(this.colorMap)) {
      let color = this.colorMap[face];
      let faceModel = new Face(face);
      let newNormal = faceModel.rotate(axis, angle2).normal().join(" ");
      let newFace = Face.FromNormal(newNormal).toString().toLowerCase();
      newMap[newFace] = color;
    }
    this.colorMap = {};
    Object.keys(newMap).forEach((face) => this.colorFace(face, newMap[face]));
  }
};

// upstream/src/algorithm-shortener.js
var import_array_element_combiner = __toESM(require_array_element_combiner());
var parallelMoves = {
  F: "B",
  R: "L",
  U: "D"
};
var algorithmShortener = (notations) => {
  if (typeof notations === "string") {
    notations = notations.split(" ");
  }
  const options = {
    compare(a, b) {
      return a[0] === b[0];
    },
    combine(a, b) {
      const aDir = a.includes("2") ? 2 : a.includes("prime") ? -1 : 1;
      const bDir = b.includes("2") ? 2 : b.includes("prime") ? -1 : 1;
      let totalDir = aDir + bDir;
      if (totalDir === 4) totalDir = 0;
      if (totalDir === -2) totalDir = 2;
      if (totalDir === 3) totalDir = -1;
      if (totalDir === 0) {
        return "";
      }
      let dirString = totalDir === 2 ? "2" : totalDir === -1 ? "prime" : "";
      return `${a[0]}${dirString}`;
    },
    cancel(value) {
      return value === "";
    },
    ignore(a, b) {
      return parallelMoves[a[0]] === b[0] || parallelMoves[b[0]] === a[0];
    }
  };
  return (0, import_array_element_combiner.default)(notations, options).join(" ");
};

// upstream/src/utils/index.js
var import_cross2 = __toESM(require_cross());
var _middlesMatchingFace = {
  f: "s",
  r: "mprime",
  u: "eprime",
  d: "e",
  l: "m",
  b: "sprime"
};
var getFaceOfMove = (move) => {
  if (typeof move !== "string") {
    throw new TypeError("move must be a string");
  }
  let faceLetter = move[0].toLowerCase();
  if (faceLetter === "f") return "front";
  if (faceLetter === "r") return "right";
  if (faceLetter === "u") return "up";
  if (faceLetter === "d") return "down";
  if (faceLetter === "l") return "left";
  if (faceLetter === "b") return "back";
};
var getMoveOfFace = (face) => {
  if (typeof face !== "string") {
    throw new TypeError("face must be a string");
  }
  face = face.toLowerCase();
  if (!["front", "right", "up", "down", "left", "back"].includes(face)) {
    throw new Error(`${face} is not valid face`);
  }
  return face[0];
};
var getMiddleMatchingFace = (face) => {
  face = face.toLowerCase()[0];
  return _middlesMatchingFace[face];
};
var getFaceMatchingMiddle = (middle) => {
  middle = middle.toLowerCase();
  for (let face of Object.keys(_middlesMatchingFace)) {
    let testMiddle = _middlesMatchingFace[face];
    if (middle === testMiddle) {
      return face;
    }
  }
};
var transformNotations = (notations, options = {}) => {
  let normalized = normalizeNotations(notations);
  if (options.upperCase) {
    normalized = normalized.map((n) => n[0].toUpperCase() + n.slice(1));
  }
  if (options.orientation) {
    normalized = orientMoves(normalized, options.orientation);
  }
  if (options.reverse) {
    normalized = _reverseNotations(normalized);
  }
  return typeof notations === "string" ? normalized.join(" ") : normalized;
};
var normalizeNotations = (notations) => {
  if (typeof notations === "string") {
    notations = notations.split(" ");
  }
  notations = notations.filter((notation) => notation !== "");
  return notations.map((notation) => {
    let isPrime = notation.toLowerCase().includes("prime");
    let isDouble = notation.includes("2");
    notation = notation[0];
    if (isDouble) notation = notation[0] + "2";
    else if (isPrime) notation = notation + "prime";
    return notation;
  });
};
var getDirectionFromFaces = (origin, target, orientation) => {
  orientation = _toLowerCase(orientation);
  orientation = _prepOrientationForDirection(orientation, origin);
  let fromFace = new Face(origin);
  let toFace = new Face(target);
  let rotations = _getRotationsForOrientation(orientation);
  _rotateFacesByRotations([fromFace, toFace], rotations);
  let axis = new Vector((0, import_cross2.default)([], fromFace.normal(), toFace.normal())).getAxis();
  let direction = Vector.getAngle(fromFace.normal(), toFace.normal());
  if (axis === "x" && direction > 0) return "down";
  if (axis === "x" && direction < 0) return "up";
  if (axis === "y" && direction > 0) return "right";
  if (axis === "y" && direction < 0) return "left";
  if (direction === 0) {
    return "front";
  } else if (direction === Math.PI) {
    return "back";
  }
};
var getFaceFromDirection = (origin, direction, orientation) => {
  orientation = _toLowerCase(orientation);
  orientation = _prepOrientationForDirection(orientation, origin);
  let fromFace = new Face(origin);
  let rotations = _getRotationsForOrientation(orientation);
  _rotateFacesByRotations([fromFace], rotations);
  let directionFace = new Face(direction);
  let { axis, angle: angle2 } = Vector.getRotationFromNormals(fromFace.normal(), directionFace.normal());
  fromFace.rotate(axis, angle2);
  let reversedRotations = rotations.map((rotation) => Vector.reverseRotation(rotation)).reverse();
  _rotateFacesByRotations([fromFace], reversedRotations);
  return fromFace.toString();
};
var getRotationFromTo = (face, from, to) => {
  const rotationFace = new Face(face);
  const fromFace = new Face(from);
  const toFace = new Face(to);
  let rotationAxis = rotationFace.vector.getAxis();
  let [fromAxis, toAxis] = [fromFace.vector.getAxis(), toFace.vector.getAxis()];
  if ([fromAxis.toLowerCase(), toAxis.toLowerCase()].includes(rotationAxis.toLowerCase())) {
    throw new Error(`moving ${rotationFace} from ${fromFace} to ${toFace} is not possible.`);
  }
  let move = getMoveOfFace(face).toUpperCase();
  let angle2 = Vector.getAngle(fromFace.normal(), toFace.normal());
  if (rotationFace.vector.getMagnitude() < 0) {
    angle2 *= -1;
  }
  if (angle2 === 0) {
    return "";
  } else if (Math.abs(angle2) === Math.PI) {
    return `${move} ${move}`;
  } else if (angle2 < 0) {
    return `${move}`;
  } else if (angle2 > 0) {
    return `${move}Prime`;
  }
};
var orientMoves = (notations, orientation) => {
  orientation = _toLowerCase(orientation);
  let rotations = _getRotationsForOrientation(orientation);
  rotations.reverse().map((rotation) => Vector.reverseRotation(rotation));
  return notations.map((notation) => {
    let isPrime = notation.toLowerCase().includes("prime");
    let isDouble = notation.includes("2");
    let isWithMiddle = notation[0] === notation[0].toLowerCase();
    let isMiddle = ["m", "e", "s"].includes(notation[0].toLowerCase());
    if (isDouble) {
      notation = notation.replace("2", "");
    }
    let face;
    if (isMiddle) {
      let faceStr = getFaceOfMove(getFaceMatchingMiddle(notation));
      face = new Face(faceStr);
    } else {
      let faceStr = getFaceOfMove(notation[0]);
      face = new Face(faceStr);
    }
    _rotateFacesByRotations([face], rotations);
    let newNotation;
    if (isMiddle) {
      newNotation = getMiddleMatchingFace(face.toString());
    } else {
      newNotation = face.toString()[0];
    }
    if (!isWithMiddle) newNotation = newNotation.toUpperCase();
    if (isDouble) newNotation = newNotation + "2";
    if (isPrime && !isMiddle) newNotation += "prime";
    return newNotation;
  });
};
function _toLowerCase(object) {
  let ret = {};
  Object.keys(object).forEach((key) => {
    ret[key.toLowerCase()] = object[key].toLowerCase();
  });
  return ret;
}
function _prepOrientationForDirection(orientation, front) {
  let keys = Object.keys(orientation);
  if (keys.length <= 1 && ["front", "back"].includes(keys[0])) {
    throw new Error(`Orientation object "${orientation}" is ambiguous. Please specify one of these faces: "up", "right", "down", "left"`);
  }
  let temp = orientation;
  orientation = {};
  keys.forEach((key) => {
    if (["front", "back"].includes(key)) {
      return;
    }
    orientation[key] = temp[key];
  });
  orientation.front = front.toLowerCase();
  return orientation;
}
function _getRotationsForOrientation(orientation) {
  if (Object.keys(orientation) <= 1) {
    throw new Error(`Orientation object "${orientation}" is ambiguous. Please specify 2 faces.`);
  }
  let keys = Object.keys(orientation);
  let origins = keys.map((key) => new Face(orientation[key]));
  let targets = keys.map((key) => new Face(key));
  let rotation1 = Vector.getRotationFromNormals(
    origins[0].normal(),
    origins[0].orientTo(targets[0]).normal()
  );
  origins[1].rotate(rotation1.axis, rotation1.angle);
  let rotation2 = Vector.getRotationFromNormals(
    origins[1].normal(),
    origins[1].orientTo(targets[1]).normal()
  );
  if (Math.abs(rotation2.angle) === Math.PI) {
    let rotation2Axis = new Face(keys[0]).vector.getAxis();
    rotation2.axis = rotation2Axis;
  }
  return [rotation1, rotation2];
}
function _rotateFacesByRotations(faces, rotations) {
  for (let face of faces) {
    for (let rotation of rotations) {
      face.rotate(rotation.axis, rotation.angle);
    }
  }
}
function _reverseNotations(notations) {
  const reversed = [];
  for (let notation of notations) {
    let isPrime = notation.includes("prime");
    notation = isPrime ? notation[0] : notation[0] + "prime";
    reversed.push(notation);
  }
  return typeof moves === "string" ? reversed.join(" ") : reversed;
}

// upstream/src/models/RubiksCube.js
var SOLVED_STATE = "fffffffffrrrrrrrrruuuuuuuuudddddddddlllllllllbbbbbbbbb";
var RubiksCube = class _RubiksCube {
  /**
   * Factory method. Returns an instance of a solved Rubiks Cube.
   */
  static Solved() {
    return new _RubiksCube(SOLVED_STATE);
  }
  /**
   * Factory method.
   * @param {string|array} moves
   */
  static FromMoves(moves2) {
    const cube = _RubiksCube.Solved();
    cube.move(moves2);
    return cube;
  }
  /**
   * Factory method. Returns an instance of a scrambled Rubiks Cube.
   */
  static Scrambled() {
    let cube = _RubiksCube.Solved();
    let randomMoves = _RubiksCube.getRandomMoves(25);
    cube.move(randomMoves);
    return cube;
  }
  /**
   * @param {string|array} notations - The list of moves to reverse.
   * @return {string|array} -- whichever was initially given.
   */
  static reverseMoves(moves2) {
    return _RubiksCube.transformMoves(moves2, { reverse: true });
  }
  /**
   * @param {string|array} moves - The moves to transform;
   * @param {object} options
   * @prop {boolean} options.upperCase - Turn lowercase moves into uppercase.
   * @prop {object} options.orientation - An object describing the orientation
   * from which to makes the moves. See src/js/utils#orientMoves.
   *
   * @return {string|array} -- whichever was initially given.
   */
  static transformMoves(moves2, options = {}) {
    return transformNotations(moves2, options);
  }
  static getRandomMoves(length = 25) {
    let randomMoves = [];
    let totalMoves = [
      "F",
      "Fprime",
      "R",
      "Rprime",
      "U",
      "Uprime",
      "D",
      "Dprime",
      "L",
      "Lprime",
      "B",
      "Bprime"
    ];
    while (randomMoves.length < length) {
      for (let i = 0; i < length - randomMoves.length; i++) {
        let idx = ~~(Math.random() * totalMoves.length);
        randomMoves.push(totalMoves[idx]);
      }
      randomMoves = algorithmShortener(randomMoves).split(" ");
    }
    return randomMoves.join(" ");
  }
  /**
   * @param {string} cubeState - The string representing the Rubik's Cube.
   *
   * The cube state are represented as:
   * 'FFFFFFFFFRRRRRRRRRUUUUUUUUUDDDDDDDDDLLLLLLLLLBBBBBBBBB'
   *
   * where:
   * F stands for the FRONT COLOR
   * R stands for the RIGHT COLOR
   * U stands for the UP COLOR
   * D stands for the DOWN COLOR
   * L stands for the LEFT COLOR
   * B stands for the BACK COLOR
   *
   * and the faces are given in the order of:
   * FRONT, RIGHT, UP, DOWN, LEFT, BACK
   *
   * The order of each color per face is ordered by starting from the top left
   * corner and moving to the bottom right, as if reading lines of text.
   *
   * See this example: http://2.bp.blogspot.com/_XQ7FznWBAYE/S9Sbric1KNI/AAAAAAAAAFs/wGAb_LcSOwo/s1600/rubik.png
   */
  constructor(cubeState) {
    if (cubeState.length !== 9 * 6) {
      throw new Error("Wrong number of colors provided");
    }
    this._notationToRotation = {
      f: { axis: "z", mag: -1 },
      r: { axis: "x", mag: -1 },
      u: { axis: "y", mag: -1 },
      d: { axis: "y", mag: 1 },
      l: { axis: "x", mag: 1 },
      b: { axis: "z", mag: 1 },
      m: { axis: "x", mag: 1 },
      e: { axis: "y", mag: 1 },
      s: { axis: "z", mag: -1 }
    };
    this._build(cubeState);
  }
  /**
   * Grab all the cubes on a given face, and return them in order from top left
   * to bottom right.
   * @param {string} face - The face to grab.
   * @return {array}
   */
  getFace(face) {
    if (typeof face !== "string") {
      throw new Error(`"face" must be a string (received: ${face})`);
    }
    face = face.toLowerCase()[0];
    let row, col, rowOrder, colOrder;
    let cubies;
    if (face === "f") {
      [row, col, rowOrder, colOrder] = ["Y", "X", -1, 1];
      cubies = this._cubies.filter((cubie) => cubie.getZ() === 1);
    } else if (face === "r") {
      [row, col, rowOrder, colOrder] = ["Y", "Z", -1, -1];
      cubies = this._cubies.filter((cubie) => cubie.getX() === 1);
    } else if (face === "u") {
      [row, col, rowOrder, colOrder] = ["Z", "X", 1, 1];
      cubies = this._cubies.filter((cubie) => cubie.getY() === 1);
    } else if (face === "d") {
      [row, col, rowOrder, colOrder] = ["Z", "X", -1, 1];
      cubies = this._cubies.filter((cubie) => cubie.getY() === -1);
    } else if (face === "l") {
      [row, col, rowOrder, colOrder] = ["Y", "Z", -1, 1];
      cubies = this._cubies.filter((cubie) => cubie.getX() === -1);
    } else if (face === "b") {
      [row, col, rowOrder, colOrder] = ["Y", "X", -1, -1];
      cubies = this._cubies.filter((cubie) => cubie.getZ() === -1);
    } else if (["m", "e", "s"].includes(face)) {
      return this._getMiddleCubiesForMove(face);
    }
    return cubies.sort((first, second) => {
      let firstCubieRow = first[`get${row}`]() * rowOrder;
      let firstCubieCol = first[`get${col}`]() * colOrder;
      let secondCubieRow = second[`get${row}`]() * rowOrder;
      let secondCubieCol = second[`get${col}`]() * colOrder;
      if (firstCubieRow < secondCubieRow) {
        return -1;
      } else if (firstCubieRow > secondCubieRow) {
        return 1;
      } else {
        return firstCubieCol < secondCubieCol ? -1 : 1;
      }
    });
  }
  /**
   * @param {array} faces - The list of faces the cubie belongs on.
   */
  getCubie(faces) {
    return this._cubies.find((cubie) => {
      if (faces.length != cubie.faces().length) {
        return false;
      }
      for (let face of faces) {
        if (!cubie.faces().includes(face)) {
          return false;
        }
      }
      return true;
    });
  }
  /**
   * Finds and returns all cubies with three colors.
   * @return {array}
   */
  corners() {
    return this._cubies.filter((cubie) => cubie.isCorner());
  }
  /**
   * Finds and returns all cubies with two colors.
   * @return {array}
   */
  edges() {
    return this._cubies.filter((cubie) => cubie.isEdge());
  }
  /**
   * Finds and returns all cubies with one color.
   * @return {array}
   */
  middles() {
    return this._cubies.filter((cubie) => cubie.isMiddle());
  }
  /**
   * Gets the rotation axis and magnitude of rotation based on notation.
   * Then finds all cubes on the correct face, and rotates them around the
   * rotation axis.
   * @param {string|array} notations - The move notation.
   * @param {object} options - Move options.
   * @prop {boolean} options.upperCase - Turn all moves to upper case (i.e. no "double" moves).
   */
  move(notations, options = {}) {
    if (typeof notations === "string") {
      notations = notations.split(" ");
    }
    notations = transformNotations(notations, options);
    for (let notation of notations) {
      let move = notation[0];
      if (!move) {
        continue;
      }
      let isPrime = notation.toLowerCase().includes("prime");
      let isWithMiddle = move === move.toLowerCase();
      let isDoubleMove = notation.includes("2");
      let { axis, mag } = this._getRotationForFace(move);
      let cubesToRotate = this.getFace(move);
      if (isPrime) mag *= -1;
      if (isDoubleMove) mag *= 2;
      if (isWithMiddle) {
        let middleMove = getMiddleMatchingFace(move);
        let middleCubies = this._getMiddleCubiesForMove(middleMove);
        cubesToRotate = [...cubesToRotate, ...middleCubies];
      }
      for (let cubie of cubesToRotate) {
        cubie.rotate(axis, mag);
      }
    }
  }
  isSolved() {
    return this.toString() === SOLVED_STATE;
  }
  toString() {
    let cubeState = "";
    let faces = ["front", "right", "up", "down", "left", "back"];
    for (let face of faces) {
      let cubies = this.getFace(face);
      for (let cubie of cubies) {
        cubeState += cubie.getColorOfFace(face);
      }
    }
    return cubeState;
  }
  clone() {
    return new _RubiksCube(this.toString());
  }
  /**
   * Create a "virtual" cube, with individual "cubies" having a 3D coordinate
   * position and 1 or more colors attached to them.
   */
  _build(cubeState) {
    this._cubies = [];
    this._populateCube();
    let parsedColors = this._parseColors(cubeState);
    for (let face of Object.keys(parsedColors)) {
      let colors = parsedColors[face];
      this._colorFace(face, colors);
    }
  }
  /**
   * Populates the "virtual" cube with 26 "empty" cubies by their position.
   * @return {null}
   */
  _populateCube() {
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) {
            continue;
          }
          let cubie = new Cubie({ position: [x, y, z] });
          this._cubies.push(cubie);
        }
      }
    }
  }
  /**
   * @return {object} - A map with faces for keys and colors for values
   */
  _parseColors(cubeState) {
    let faceColors = {
      front: [],
      right: [],
      up: [],
      down: [],
      left: [],
      back: []
    };
    let currentFace;
    for (let i = 0; i < cubeState.length; i++) {
      let color = cubeState[i];
      if (i < 9) {
        currentFace = "front";
      } else if (i < 9 * 2) {
        currentFace = "right";
      } else if (i < 9 * 3) {
        currentFace = "up";
      } else if (i < 9 * 4) {
        currentFace = "down";
      } else if (i < 9 * 5) {
        currentFace = "left";
      } else {
        currentFace = "back";
      }
      faceColors[currentFace].push(color);
    }
    return faceColors;
  }
  /**
   * @param {array} face - An array of the cubies on the given face.
   * @param {array} colors - An array of the colors on the given face.
   */
  _colorFace(face, colors) {
    let cubiesToColor = this.getFace(face);
    for (let i = 0; i < colors.length; i++) {
      cubiesToColor[i].colorFace(face, colors[i]);
    }
  }
  /**
   * @return {object} - The the rotation axis and magnitude for the given face.
   */
  _getRotationForFace(face) {
    if (typeof face !== "string") {
      throw new Error(`"face" must be a string (received: ${face})`);
    }
    face = face.toLowerCase();
    return {
      axis: this._notationToRotation[face].axis,
      mag: this._notationToRotation[face].mag * Math.PI / 2
    };
  }
  _getMiddleCubiesForMove(move) {
    move = move[0].toLowerCase();
    let nonMiddles;
    if (move === "m") {
      nonMiddles = ["left", "right"];
    } else if (move === "e") {
      nonMiddles = ["up", "down"];
    } else if (move === "s") {
      nonMiddles = ["front", "back"];
    }
    return this._cubies.filter((cubie) => {
      return !cubie.hasFace(nonMiddles[0]) && !cubie.hasFace(nonMiddles[1]);
    });
  }
};

// upstream/src/solvers/BaseSolver.js
var BaseSolver = class {
  /**
   * Solves the first step following the Fridrich Method: the cross. Solves the
   * cross on the UP face by default.
   *
   * @param {string|RubiksCube} rubiksCube - This can either be a 54-character
   * long string representing the cube state (in this case it will have to
   * "build" another rubik's Cube), or an already built RubiksCube object.
   */
  constructor(rubiksCube, options = {}) {
    this.cube = typeof rubiksCube === "string" ? new RubiksCube(rubiksCube) : rubiksCube;
    this.options = options;
    this.partition = {};
    this.partitions = [];
    this.totalMoves = [];
    this._afterEachCallbacks = [];
  }
  /**
   * @param {string|array} notation - A string of move(s) to execute and store.
   * @param {object} options - The options to pass to RubiksCube#move.
   */
  move(notations, options) {
    if (typeof notations === "string") {
      notations = notations.split(" ");
    }
    this.cube.move(notations, options);
    notations = transformNotations(notations, options);
    for (let notation of notations) {
      this.totalMoves.push(notation);
    }
  }
  afterEach(callback) {
    this._afterEachCallbacks.push(callback);
  }
  /**
   * @param {...*} callbackArgs - The arguments to call the function with.
   */
  _triggerAfterEach(...callbackArgs) {
    this._afterEachCallbacks.forEach((fn) => fn(...callbackArgs));
  }
  /**
   * Solves the edge and/or corner and returns information about the state
   * about them right before they are solved. It's important to construct the
   * object in steps for debugging, so that we can still have access to e.g.
   * the case number if the solve method fails.
   */
  _solve(cubies = {}) {
    this.partition = {};
    this.partition.cubies = cubies;
    let { corner, edge } = cubies;
    this.partition.caseNumber = this._getCaseNumber({ corner, edge });
    this._solveCase(this.partition.caseNumber, { corner, edge });
    this.partition.moves = this.totalMoves;
    this.totalMoves = [];
    if (!this._overrideAfterEach) {
      this._triggerAfterEach(this.partition, this.phase);
    }
    return this.partition;
  }
  _solveCase(caseNumber, cubies = {}) {
    let { corner, edge } = cubies;
    this[`_solveCase${caseNumber}`]({ corner, edge });
  }
};

// upstream/src/solvers/cross/index.js
var CROSS_COLOR = "u";
var R = (moves2) => RubiksCube.reverseMoves(moves2);
var CrossSolver = class extends BaseSolver {
  constructor(...args) {
    super(...args);
    this.phase = "cross";
  }
  solve() {
    let crossEdges = this._getCrossEdges();
    for (let edge of crossEdges) {
      let partition = this._solve({ edge });
      this.partitions.push(partition);
    }
    return this.partitions;
  }
  isSolved() {
    let edges = this._getCrossEdges();
    for (let edge of edges) {
      if (!this.isEdgeSolved(edge)) {
        return false;
      }
    }
    return true;
  }
  isEdgeSolved(edge) {
    let otherColor = edge.colors().find((color) => color !== "u");
    let otherFace = edge.faces().find((face) => face !== "up");
    const matchesMiddle = otherFace[0] === otherColor;
    const isOnCrossFace = edge.getColorOfFace("up") === "u";
    return isOnCrossFace && matchesMiddle;
  }
  /**
   * Finds all edges that have 'F' as a color.
   * @return {array}
   */
  _getCrossEdges() {
    return this.cube.edges().filter((edge) => edge.hasColor(CROSS_COLOR));
  }
  /**
   * 6 Cases!
   * 1) The edge's UP color is on the UP face.
   * 2) the edge's UP color is on the DOWN face.
   * 3) The edge's UP color is not on the UP or DOWN face and the other color is on the UP face.
   * 4) The edge's UP color is not on the UP or DOWN face and the other color is on the DOWN face.
   * 5) The edge's UP color is not on the UP or DOWN face and the other color is on the RELATIVE RIGHT face.
   * 6) The edge's UP color is not on the UP or DOWN face and the other color is on the RELATIVE LEFT face.
   *
   * @param {cubie} edge
   */
  _getCaseNumber({ edge }) {
    if (edge.getColorOfFace("up") === CROSS_COLOR) {
      return 1;
    } else if (edge.getColorOfFace("down") === CROSS_COLOR) {
      return 2;
    }
    if (edge.faces().includes("up")) {
      return 3;
    } else if (edge.faces().includes("down")) {
      return 4;
    }
    let crossFace = edge.getFaceOfColor(CROSS_COLOR);
    let otherFace = edge.getFaceOfColor(edge.colors().find((color) => color !== CROSS_COLOR));
    let direction = getDirectionFromFaces(crossFace, otherFace, { up: "up" });
    if (direction === "right") {
      return 5;
    } else if (direction === "left") {
      return 6;
    }
  }
  _solveCase1({ edge }) {
    if (this.isEdgeSolved(edge)) {
      return;
    }
    let face = edge.faces().find((face2) => face2 !== "up");
    this.move(`${face} ${face}`, { upperCase: true });
    this._solveCase2({ edge });
  }
  _solveCase2({ edge }) {
    let solveMoves = this._case1And2Helper({ edge }, 2);
    this.move(solveMoves, { upperCase: true });
  }
  _solveCase3({ edge }) {
    let prepMove = this._case3And4Helper({ edge }, 3);
    this.move(prepMove, { upperCase: true });
    this._solveCase5({ edge });
  }
  _solveCase4({ edge }) {
    let prepMove = getRotationFromTo(
      "down",
      edge.getFaceOfColor("u"),
      getFaceOfMove(edge.getColorOfFace("down"))
    );
    this.move(prepMove, { upperCase: true });
    let edgeToMiddle = R(edge.getFaceOfColor("u"));
    this.move(edgeToMiddle, { upperCase: true });
    this._solveCase5({ edge });
  }
  _solveCase5({ edge }) {
    let solveMoves = this._case5And6Helper({ edge }, 5);
    this.move(solveMoves, { upperCase: true });
  }
  _solveCase6({ edge }) {
    let solveMoves = this._case5And6Helper({ edge }, 6);
    this.move(solveMoves, { upperCase: true });
  }
  _case1And2Helper({ edge }, caseNum) {
    let crossColorFace = caseNum === 1 ? "up" : "down";
    let currentFace = edge.faces().find((face) => face !== crossColorFace);
    let targetFace = getFaceOfMove(edge.getColorOfFace(currentFace));
    let solveMoves = getRotationFromTo(crossColorFace, currentFace, targetFace);
    if (caseNum === 2) {
      let edgeToCrossFace = getMoveOfFace(targetFace);
      solveMoves += ` ${edgeToCrossFace} ${edgeToCrossFace}`;
    }
    return solveMoves;
  }
  _case3And4Helper({ edge }, caseNum) {
    let prepMove = edge.faces().find((face) => !["up", "down"].includes(face));
    if (caseNum === 4) {
      prepMove = R(prepMove);
    }
    return prepMove;
  }
  _case5And6Helper({ edge }, caseNum) {
    let otherColor = edge.colors().find((color) => color !== "u");
    let currentFace = edge.getFaceOfColor(otherColor);
    let targetFace = getFaceOfMove(otherColor);
    let prepMove = getRotationFromTo("up", currentFace, targetFace);
    let edgeToCrossFace = getMoveOfFace(currentFace);
    if (caseNum === 6) {
      edgeToCrossFace = R(edgeToCrossFace);
    }
    return `${R(prepMove)} ${edgeToCrossFace} ${prepMove}`;
  }
  _getPartitionBefore({ edge }) {
    return { edge: edge.clone() };
  }
  _getPartitionAfter({ edge }) {
    return { edge };
  }
};

// upstream/src/solvers/f2l/F2LBaseSolver.js
var R2 = (moves2) => RubiksCube.reverseMoves(moves2);
var F2LBaseSolver = class extends BaseSolver {
  constructor(...args) {
    super(...args);
    this.phase = "f2l";
  }
  colorsMatch({ corner, edge }) {
    let colors = edge.colors();
    if (corner.colors().includes(colors[0]) && corner.colors().includes(colors[1])) {
      return true;
    }
    return false;
  }
  /**
   * Returns true only if the pair is matched and in the correct slot.
   */
  isPairSolved({ corner, edge }) {
    if (!this.isPairMatched({ corner, edge })) {
      return false;
    }
    if (corner.getFaceOfColor("u") !== "up") {
      return false;
    }
    for (let color of edge.colors()) {
      if (edge.getFaceOfColor(color) !== getFaceOfMove(color)) {
        return false;
      }
    }
    return true;
  }
  isPairMatched({ corner, edge }) {
    if (!this.colorsMatch({ corner, edge })) {
      return false;
    }
    for (let color of edge.colors()) {
      if (corner.getFaceOfColor(color) !== edge.getFaceOfColor(color)) {
        return false;
      }
    }
    return true;
  }
  isPairSeparated({ corner, edge }) {
    if (!this.colorsMatch({ corner, edge })) {
      return false;
    }
    if (["up", "down"].includes(corner.getFaceOfColor("u"))) {
      return false;
    }
    if (!edge.faces().includes("down")) {
      return false;
    }
    let otherColor = corner.colors().find((color) => {
      return color !== "u" && corner.getFaceOfColor(color) !== "down";
    });
    if (edge.getFaceOfColor(otherColor) !== "down") {
      return false;
    }
    let isOneMoveFromMatched = getDirectionFromFaces(
      corner.getFaceOfColor(otherColor),
      edge.getFaceOfColor(corner.getColorOfFace("down")),
      { up: "up" }
    ) === "back";
    return isOneMoveFromMatched;
  }
  solveMatchedPair({ corner, edge }) {
    if (!this.isPairMatched({ corner, edge })) {
      throw new Error("Pair is not matched");
    }
    let matchedColor = edge.colors().find((color) => {
      return edge.getFaceOfColor(color) !== "down";
    });
    let isLeft = getDirectionFromFaces(
      edge.getFaceOfColor(matchedColor),
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let matchingFace = getFaceOfMove(matchedColor);
    let currentFace = corner.getFaceOfColor(matchedColor);
    let prepFace = getFaceFromDirection(matchingFace, isLeft ? "left" : "right", { up: "down" });
    let prep = getRotationFromTo("down", currentFace, prepFace);
    let open = isLeft ? matchingFace : R2(matchingFace);
    let insert = isLeft ? "DPrime" : "D";
    let solveMoves = [prep, open, insert, R2(open)].join(" ");
    this.move(solveMoves, { upperCase: true });
    return solveMoves;
  }
  solveSeparatedPair({ corner, edge }) {
    if (!this.isPairSeparated({ corner, edge })) {
      throw new Error("Pair is not separated");
    }
    let matchedColor = edge.colors().find((color) => {
      return edge.getFaceOfColor(color) !== "down";
    });
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor("u"),
      edge.getFaceOfColor(matchedColor),
      { up: "down" }
    ).toUpperCase() === "LEFT";
    let currentFace = corner.getFaceOfColor("u");
    let prepFace = getFaceOfMove(matchedColor);
    let prep = getRotationFromTo("down", currentFace, prepFace);
    let match = getMoveOfFace(prepFace);
    match = isLeft ? R2(match) : match;
    let insert = isLeft ? "DPrime" : "D";
    let solveMoves = [prep, match, insert, R2(match)].join(" ");
    this.move(solveMoves, { upperCase: true });
    return solveMoves;
  }
  _getPartitionBefore({ corner, edge }) {
    return {
      corner: corner.clone(),
      edge: edge.clone()
    };
  }
  _getPartitionAfter({ corner, edge }) {
    return { corner, edge };
  }
};

// upstream/src/solvers/f2l/cases/F2LCaseBaseSolver.js
var F2LCaseBaseSolver = class extends F2LBaseSolver {
  solve({ corner, edge }) {
    return this._solve({ corner, edge });
  }
};

// upstream/src/solvers/f2l/cases/case-1.js
var R3 = (moves2) => RubiksCube.reverseMoves(moves2);
var Case1Solver = class extends F2LCaseBaseSolver {
  /**
   * 10 Cases:
   * 1) Pair is matched.
   * 2) Pair is separated.
   *
   * ---- Group 1: Corner's white color is on DOWN face ----
   * 3) Corner and edge share a face and colors on that face are equal.
   * 4) Corner and edge share a face and colors on that face are not equal.
   * 5) Corner and edge do not share a face.
   *
   * ---- Group 2: Corner's "other" color matches edge's "primary" color ----
   * 6) Corner shares a face with edge.
   * 7) Corner does not share a face with edge.
   *
   * ---- Group 3: Corner's "other" color doesn't match edge's "primary" color ----
   * 8) Edge shares a face with corner's cross color's face.
   * 9) Edge shares a face with corner's other color's face.
   * 10) Corner does not share a face with edge.
   *
   * TODO: refactor
   */
  _getCaseNumber({ corner, edge }) {
    if (this.isPairMatched({ corner, edge })) {
      return 1;
    }
    if (this.isPairSeparated({ corner, edge })) {
      return 2;
    }
    let sharedFace;
    edge.faces().forEach((face) => {
      if (corner.faces().includes(face) && face !== "down") {
        sharedFace = face;
      }
    });
    let otherColor = corner.colors().find((color) => {
      return color !== "u" && color !== corner.getColorOfFace("down");
    });
    let primaryColor = edge.colors().find((c) => edge.getFaceOfColor(c) !== "down");
    if (corner.getFaceOfColor("u") === "down") {
      if (sharedFace) {
        if (corner.getColorOfFace(sharedFace) === edge.getColorOfFace(sharedFace)) {
          return 3;
        } else {
          return 4;
        }
      } else {
        return 5;
      }
    }
    if (otherColor === primaryColor) {
      if (sharedFace) {
        return 6;
      } else {
        return 7;
      }
    }
    if (sharedFace) {
      if (sharedFace === corner.getFaceOfColor("u")) {
        return 8;
      } else {
        return 9;
      }
    } else {
      return 10;
    }
  }
  _solveCase1({ corner, edge }) {
    return this.solveMatchedPair({ corner, edge });
  }
  _solveCase2({ corner, edge }) {
    return this.solveSeparatedPair({ corner, edge });
  }
  _solveCase3({ corner, edge }) {
    let currentFace = edge.faces().find((face) => face !== "down");
    let targetFace = getFaceOfMove(edge.getColorOfFace("down"));
    let prepFace = getFaceFromDirection(targetFace, "back", { up: "down" });
    let otherFace = corner.getFaceOfColor(edge.getColorOfFace("down"));
    let isLeft = getFaceFromDirection(currentFace, otherFace, { up: "down" }) === "left";
    let prep = getRotationFromTo("down", currentFace, prepFace);
    let moveFace = getFaceOfMove(edge.getColorOfFace(currentFace));
    let dir = isLeft ? "D" : "DPrime";
    moveFace = isLeft ? moveFace : R3(moveFace);
    let solveMoves = `${prep} ${moveFace} ${moveFace} D D `;
    solveMoves += `${moveFace} ${dir} ${R3(moveFace)} ${dir} ${moveFace} ${moveFace}`;
    this.move(solveMoves, { upperCase: true });
  }
  _solveCase4({ corner, edge }) {
    let currentFace = edge.faces().find((face) => face !== "down");
    let targetFace = getFaceOfMove(edge.getColorOfFace(currentFace));
    let otherFace = corner.faces().find((face) => !edge.faces().includes(face));
    let isLeft = getFaceFromDirection(otherFace, currentFace, { up: "down" }) === "left";
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let moveFace = getMoveOfFace(targetFace);
    moveFace = isLeft ? R3(moveFace) : moveFace;
    this.move(`${prep} ${moveFace} D D ${R3(moveFace)}`, { upperCase: true });
    this.solveSeparatedPair({ corner, edge });
  }
  _solveCase5({ corner, edge }) {
    let primary = edge.colors().find((color) => edge.getFaceOfColor(color) !== "down");
    let secondary = edge.colors().find((color) => edge.getFaceOfColor(color) === "down");
    let isLeft = getFaceFromDirection(
      getFaceOfMove(primary),
      getFaceOfMove(secondary),
      { up: "down" }
    ) === "right";
    let edgeCurrent = edge.getFaceOfColor(primary);
    let edgeTarget = getFaceOfMove(primary);
    let edgePrep = getRotationFromTo("down", edgeCurrent, edgeTarget);
    this.move(edgePrep, { upperCase: true });
    let cornerCurrent = corner.getFaceOfColor(primary);
    let cornerTarget = edgeTarget;
    let cornerPrep = getRotationFromTo("down", cornerCurrent, cornerTarget);
    let open = isLeft ? R3(edgeTarget) : edgeTarget;
    this.move(`${open} ${cornerPrep} ${R3(open)}`, { upperCase: true });
    this.solveMatchedPair({ corner, edge });
  }
  _solveCase6({ corner, edge }) {
    let primary = edge.colors().find((color) => edge.getFaceOfColor(color) !== "down");
    let currentFace = edge.getFaceOfColor(primary);
    let targetFace = getFaceOfMove(edge.getColorOfFace("down"));
    let isLeft = getDirectionFromFaces(
      currentFace,
      corner.getFaceOfColor(primary),
      { up: "down" }
    ) === "left";
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let moveFace = isLeft ? targetFace : R3(targetFace);
    let dir = isLeft ? "DPrime" : "D";
    this.move(`${prep} ${moveFace} ${dir} ${R3(moveFace)}`, { upperCase: true });
    this.solveSeparatedPair({ corner, edge });
  }
  _solveCase7({ corner, edge }) {
    let primary = edge.colors().find((c) => edge.getFaceOfColor(c) !== "down");
    let cornerCurrent = corner.getFaceOfColor("u");
    let cornerTarget = getFaceOfMove(primary);
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor(primary),
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let cornerPrep = getRotationFromTo("down", cornerCurrent, cornerTarget);
    this.move(cornerPrep, { upperCase: true });
    let edgeCurrent = edge.getFaceOfColor(primary);
    let edgeTarget = corner.getFaceOfColor(primary);
    let open = isLeft ? corner.getFaceOfColor("u") : R3(corner.getFaceOfColor("u"));
    let edgeMatch = getRotationFromTo("down", edgeCurrent, edgeTarget);
    this.move(`${open} ${edgeMatch} ${R3(open)}`, { upperCase: true });
    this.solveMatchedPair({ corner, edge });
  }
  _solveCase8({ corner, edge }) {
    let primary = edge.colors().find((c) => edge.getFaceOfColor(c) !== "down");
    let secondary = edge.colors().find((c) => edge.getFaceOfColor(c) === "down");
    let currentFace = corner.getFaceOfColor(secondary);
    let targetFace = getFaceOfMove(primary);
    let isLeft = getDirectionFromFaces(
      currentFace,
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let open = isLeft ? R3(targetFace) : targetFace;
    let dir = isLeft ? "D" : "DPrime";
    this.move(`${prep} ${open} ${dir} ${R3(open)}`, { upperCase: true });
    this.solveSeparatedPair({ corner, edge });
  }
  _solveCase9({ corner, edge }) {
    let otherColor = edge.colors().find((c) => edge.getFaceOfColor(c) === "down");
    let currentFace = corner.getFaceOfColor("u");
    let targetFace = getFaceOfMove(otherColor);
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor(otherColor),
      currentFace,
      { up: "down" }
    ) === "left";
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let moveFace = isLeft ? targetFace : R3(targetFace);
    this.move(`${prep} ${moveFace} D D ${R3(moveFace)}`, { upperCase: true });
    this.solveSeparatedPair({ corner, edge });
  }
  _solveCase10({ corner, edge }) {
    let primary = edge.colors().find((c) => edge.getFaceOfColor(c) !== "down");
    let secondary = edge.colors().find((c) => edge.getFaceOfColor(c) === "down");
    let cornerCurrent = corner.getFaceOfColor("u");
    let cornerTarget = getFaceOfMove(secondary);
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor(secondary),
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let cornerPrep = getRotationFromTo("down", cornerCurrent, cornerTarget);
    this.move(cornerPrep, { upperCase: true });
    let edgeCurrent = edge.getFaceOfColor(primary);
    let edgeTarget = getFaceOfMove(primary);
    let open = isLeft ? cornerTarget : R3(cornerTarget);
    let edgePrep = getRotationFromTo("down", edgeCurrent, edgeTarget);
    this.move(`${open} ${edgePrep} ${R3(open)}`, { upperCase: true });
    this.solveSeparatedPair({ corner, edge });
  }
};

// upstream/src/solvers/f2l/cases/case-2.js
var R4 = (moves2) => RubiksCube.reverseMoves(moves2);
var Case2Solver = class extends F2LCaseBaseSolver {
  /**
   * 4 cases:
   *
   * ---- Group 1: Corner's white color is on DOWN face ----
   * 1) Pair can be matched up.
   * 2) Pair cannot be matched up.
   *
   * ---- Group 2: Corner's white color is not on DOWN face ----
   * 3) Corner's other color can match up with the edge color on that face.
   * 4) Corner's other color cannot match up with the edge color on that face.
   */
  _getCaseNumber({ corner, edge }) {
    let cFaces = corner.faces().filter((face) => face !== "down");
    let eFaces = edge.faces();
    let cornerDir = getDirectionFromFaces(cFaces[0], cFaces[1], { up: "down" });
    let edgeDir = getDirectionFromFaces(eFaces[0], eFaces[1], { up: "down" });
    let cornerRight = cornerDir === "right" ? cFaces[1] : cFaces[0];
    let edgeRight = edgeDir === "right" ? eFaces[1] : eFaces[0];
    if (corner.getFaceOfColor("u") === "down") {
      if (corner.getColorOfFace(cornerRight) === edge.getColorOfFace(edgeRight)) {
        return 1;
      } else {
        return 2;
      }
    }
    let otherColor = corner.colors().find((color) => {
      return color !== "u" && color !== corner.getColorOfFace("down");
    });
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor(otherColor),
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let matchingEdgeColor = isLeft ? edge.getColorOfFace(edgeRight) : edge.colors().find((c) => edge.getFaceOfColor(c) !== edgeRight);
    if (otherColor === matchingEdgeColor) {
      return 3;
    } else {
      return 4;
    }
  }
  _solveCase1({ corner, edge }) {
    let color = edge.colors()[0];
    let currentFace = corner.getFaceOfColor(color);
    let targetFace = edge.getFaceOfColor(color);
    let prep = getRotationFromTo("down", currentFace, targetFace);
    this.move(prep, { upperCase: true });
    let [face1, face2] = edge.faces();
    let dir = getDirectionFromFaces(face1, face2, { up: "down" });
    let rightFace = dir === "right" ? face2 : face1;
    this.move(`${rightFace} DPrime ${R4(rightFace)}`, { upperCase: true });
    this.solveMatchedPair({ corner, edge });
  }
  _solveCase2({ corner, edge }) {
    let currentFace = corner.getFaceOfColor(edge.colors()[0]);
    let targetFace = edge.getFaceOfColor(edge.colors()[1]);
    let prep = getRotationFromTo("down", currentFace, targetFace);
    this.move(prep, { upperCase: true });
    let dir = getDirectionFromFaces(edge.faces()[0], edge.faces()[1], { up: "down" });
    let rightFace = edge.faces()[dir === "right" ? 1 : 0];
    this.move(`${rightFace} D ${R4(rightFace)} DPrime`, { upperCase: true });
    this.move(`${rightFace} D ${R4(rightFace)}`, { upperCase: true });
    this.solveSeparatedPair({ corner, edge });
  }
  _solveCase3({ corner, edge }) {
    this._case3And4Helper({ corner, edge }, 3);
  }
  _solveCase4({ corner, edge }) {
    this._case3And4Helper({ corner, edge }, 4);
  }
  _case3And4Helper({ corner, edge }, caseNum) {
    let downColor = corner.getColorOfFace("down");
    let otherColor = corner.colors().find((c) => ![downColor, "u"].includes(c));
    let matchingColor = caseNum === 3 ? otherColor : downColor;
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor(otherColor),
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let currentFace = corner.getFaceOfColor("u");
    let targetFace = edge.getFaceOfColor(matchingColor);
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let moveFace = isLeft ? targetFace : R4(targetFace);
    let dir = isLeft ? "DPrime" : "D";
    dir = caseNum === 4 ? R4(dir) : dir;
    this.move(`${prep} ${moveFace} ${dir} ${R4(moveFace)}`, { upperCase: true });
    let method = `solve${caseNum === 3 ? "Matched" : "Separated"}Pair`;
    this[method]({ corner, edge });
  }
};

// upstream/src/solvers/f2l/cases/case-3.js
var R5 = (moves2) => RubiksCube.reverseMoves(moves2);
var Case3Solver = class extends F2LCaseBaseSolver {
  /**
    * 2 cases:
    *
    * 1) Corner's cross color is on the cross face.
    * 2) Corner's cross color is not on the cross face.
    */
  _getCaseNumber({ corner, edge }) {
    if (corner.getColorOfFace("up") === "u") {
      return 1;
    } else {
      return 2;
    }
  }
  _solveCase1({ corner, edge }) {
    let faces = corner.faces().filter((face) => face !== "up");
    let direction = getDirectionFromFaces(faces[0], faces[1], { up: "down" });
    let [leftFace, rightFace] = direction === "right" ? faces : faces.reverse();
    let currentFace = edge.faces().find((face) => face !== "down");
    let primaryColor = edge.getColorOfFace(currentFace);
    let targetFace = getFaceFromDirection(
      corner.getFaceOfColor(primaryColor),
      primaryColor === corner.getColorOfFace(rightFace) ? "right" : "left",
      { up: "down" }
    );
    let isLeft = primaryColor === corner.getColorOfFace(leftFace);
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let moveFace = isLeft ? rightFace : R5(leftFace);
    let dir = isLeft ? "DPrime" : "D";
    this.move(`${prep} ${moveFace} ${dir} ${R5(moveFace)}`, { upperCase: true });
    this.solveMatchedPair({ corner, edge });
  }
  _solveCase2({ corner, edge }) {
    let otherColor = corner.colors().find((color) => {
      return color !== "u" && corner.getFaceOfColor(color) !== "up";
    });
    let currentFace = edge.faces().find((face) => face !== "down");
    let primaryColor = edge.getColorOfFace(currentFace);
    let willBeMatched = otherColor !== primaryColor;
    let targetFace = corner.getFaceOfColor(willBeMatched ? otherColor : "u");
    let prep = getRotationFromTo("down", currentFace, targetFace);
    let isLeft = getDirectionFromFaces(
      corner.getFaceOfColor(otherColor),
      corner.getFaceOfColor("u"),
      { up: "down" }
    ) === "left";
    let dir = isLeft ? "DPrime" : "D";
    let moveFace = corner.getFaceOfColor("u");
    moveFace = isLeft ? R5(moveFace) : moveFace;
    this.move(`${prep} ${moveFace} ${dir} ${R5(moveFace)}`, { upperCase: true });
    let solveFn = `solve${willBeMatched ? "Matched" : "Separated"}Pair`;
    this[solveFn]({ corner, edge });
  }
};

// upstream/src/solvers/f2l/index.js
var R6 = (moves2) => RubiksCube.reverseMoves(moves2);
var F2LSolver = class extends F2LBaseSolver {
  constructor(...args) {
    super(...args);
    this.subCaseOptions = Object.assign(this.options, {
      _overrideAfterEach: true
    });
  }
  solve() {
    this.partitions = [];
    let pairs = this.getAllPairs();
    pairs.forEach(({ corner, edge }) => {
      let partition = this._solve({ corner, edge });
      this.partitions.push(partition);
    });
    return this.partitions;
  }
  isSolved() {
    let pairs = this.getAllPairs();
    for (let pair of pairs) {
      if (!this.isPairSolved(pair)) {
        return false;
      }
    }
    return true;
  }
  getAllPairs() {
    let corners = this.cube.corners().filter((corner) => {
      return corner.hasColor("u");
    });
    let edges = this.cube.edges().filter((edge) => {
      return !edge.hasColor("u") && !edge.hasColor("d");
    });
    let pairs = [];
    for (let edge of edges) {
      let corner = corners.find((corner2) => {
        let colors = edge.colors();
        return corner2.hasColor(colors[0]) && corner2.hasColor(colors[1]);
      });
      pairs.push({ edge, corner });
    }
    return pairs;
  }
  /**
   * 4 top level cases: (cross face is UP)
   *
   * 1) Corner and edge are both on the DOWN face.
   * 2) Corner is on the DOWN face and edge is not on DOWN face.
   * 3) Corner is on UP face and edge is on DOWN face.
   * 4) Corner is on UP face and edge is not on DOWN face.
   */
  _getCaseNumber({ corner, edge }) {
    if (corner.faces().includes("down")) {
      if (edge.faces().includes("down")) {
        return 1;
      }
      if (!edge.faces().includes("down") && !edge.faces().includes("up")) {
        return 2;
      }
    }
    if (corner.faces().includes("up")) {
      if (edge.faces().includes("down")) {
        return 3;
      }
      if (!edge.faces().includes("down") && !edge.faces().includes("up")) {
        return 4;
      }
    }
    throw new Error("Could not find a top level F2L case");
  }
  _solveCase1({ corner, edge }) {
    let solver = new Case1Solver(this.cube, this.subCaseOptions);
    let partition = solver.solve({ corner, edge });
    this.totalMoves = partition.moves;
    this.partition.caseNumber = [this.partition.caseNumber, partition.caseNumber];
  }
  _solveCase2({ corner, edge }) {
    let solver = new Case2Solver(this.cube, this.subCaseOptions);
    let partition = solver.solve({ corner, edge });
    this.totalMoves = partition.moves;
    this.partition.caseNumber = [this.partition.caseNumber, partition.caseNumber];
  }
  _solveCase3({ corner, edge }) {
    let solver = new Case3Solver(this.cube, this.subCaseOptions);
    let partition = solver.solve({ corner, edge });
    this.totalMoves = partition.moves;
    this.partition.caseNumber = [this.partition.caseNumber, partition.caseNumber];
  }
  _solveCase4({ corner, edge }) {
    if (this.isPairSolved({ corner, edge })) {
      return;
    }
    let solver;
    if (corner.faces().includes(edge.faces()[0]) && corner.faces().includes(edge.faces()[1])) {
      solver = new Case1Solver(this.cube, this.subCaseOptions);
    } else {
      solver = new Case2Solver(this.cube, this.subCaseOptions);
    }
    let faces = corner.faces().filter((face) => face !== "up");
    let dir = getDirectionFromFaces(faces[0], faces[1], { up: "down" });
    let cornerRightFace = dir === "right" ? faces[1] : faces[0];
    this.move(`${cornerRightFace} D ${R6(cornerRightFace)}`, { upperCase: true });
    let partition = solver.solve({ corner, edge });
    this.partition.caseNumber = [this.partition.caseNumber, partition.caseNumber];
    this.totalMoves = [...this.totalMoves, ...partition.moves];
  }
};

// upstream/src/solvers/oll/index.js
var SOLVED_STATE2 = "00000000";
var OLLSolver = class extends BaseSolver {
  constructor(...args) {
    super(...args);
    this.phase = "oll";
    this.algorithms = {
      [SOLVED_STATE2]: "",
      // solved state
      "21000110": "F R U RPrime UPrime FPrime",
      // 1
      "21211010": "F R U RPrime UPrime FPrime F R U RPrime UPrime FPrime",
      // 2
      "10201020": "R U2 RPrime UPrime R U RPrime UPrime R UPrime RPrime",
      // 3
      "01112000": "F U R UPrime RPrime FPrime",
      // 4
      "11102120": "F U R UPrime RPrime U R UPrime RPrime FPrime",
      // 5
      "11210000": "RPrime UPrime FPrime U F R",
      // 6
      "11102021": "FPrime LPrime UPrime L U LPrime UPrime L U F",
      // 7
      "10011110": "R L2 BPrime L BPrime LPrime B2 L BPrime L RPrime",
      // 8
      "00202121": "LPrime R2 B RPrime B R B2 RPrime B RPrime L",
      // 9
      "01111111": "F U R UPrime RPrime FPrime L F U FPrime UPrime LPrime",
      // 10
      "21212101": "F U R UPrime RPrime FPrime R B U BPrime UPrime RPrime",
      // 11
      "21211111": "F R U RPrime UPrime FPrime B U L UPrime LPrime BPrime",
      // 12
      "20201010": "R U2 R2 UPrime R2 UPrime R2 U2 R",
      // 13
      "01101110": "R B RPrime L U LPrime UPrime R BPrime RPrime",
      // 14
      "21002120": "LPrime BPrime L RPrime UPrime R U LPrime B L",
      // 15
      "21001100": "RPrime F R U RPrime UPrime FPrime U R",
      // 16
      "01000100": "R U RPrime UPrime MPrime U R UPrime rPrime",
      // 17
      "01010101": "M U R U RPrime UPrime M2 U R UPrime rPrime",
      // 18
      "10211021": "F R U RPrime UPrime R U RPrime UPrime FPrime B U L UPrime LPrime BPrime",
      // 19
      "11000120": "R U RPrime UPrime RPrime F R FPrime",
      // 20
      "10000020": "LPrime BPrime R B L BPrime RPrime B",
      // 21
      "20001000": "B LPrime BPrime R B L BPrime RPrime",
      // 22
      "00112001": "RPrime UPrime RPrime F R FPrime U R",
      // 23
      "21112111": "R U2 RPrime RPrime F R FPrime U2 RPrime F R FPrime",
      // 24
      "10002101": "R U2 RPrime RPrime F R FPrime R U2 RPrime",
      // 25
      "21110101": "M U R U RPrime UPrime MPrime RPrime F R FPrime",
      // 26
      "11212010": "F LPrime U2 L U2 L F2 LPrime F",
      // 27
      "01110020": "R U RPrime U R UPrime RPrime UPrime RPrime F R FPrime",
      // 28
      "10012100": "RPrime UPrime R UPrime RPrime U R U R BPrime RPrime B",
      // 29
      "10112021": "RPrime UPrime R UPrime RPrime U FPrime U F R",
      // 30
      "01110121": "F U R UPrime RPrime FPrime F U FPrime UPrime FPrime L F LPrime",
      // 31
      "01112101": "F U R UPrime RPrime FPrime B U BPrime UPrime SPrime U B UPrime bPrime",
      // 32
      "21212000": "lPrime U2 L U LPrime U l",
      // 33
      "01212020": "r U RPrime U R U2 rPrime",
      // 34
      "00202020": "R U RPrime U R U2 RPrime",
      // 35
      "10101000": "RPrime UPrime R URprime RPrime U2 R",
      // 36
      "01001021": "RPrime U R U2 RPrime UPrime FPrime U F U R",
      // 37
      "10200101": "R UPrime RPrime U2 R U B UPrime BPrime UPrime RPrime",
      // 38
      "21102011": "r U RPrime U R UPrime RPrime U R U2 rPrime",
      // 39
      "21112010": "lPrime UPrime L UPrime LPrime U L UPrime LPrime U2 l",
      // 40
      "11100011": "r U2 RPrime UPrime R UPrime rPrime",
      // 41
      "11012000": "F R UPrime RPrime UPrime R U RPrime FPrime",
      // 42
      "11001011": "lPrime UPrime L UPrime LPrime U2 l",
      // 43
      "01010000": "r U RPrime UPrime M U R UPrime RPrime",
      // 44
      "01002110": "R U RPrime UPrime BPrime RPrime F R FPrime B",
      // 45
      "01202120": "L FPrime LPrime UPrime L F LPrime FPrime U F",
      // 46
      "11001110": "RPrime F R U RPrime FPrime R F UPrime FPrime",
      // 47
      "10200000": "R2 D RPrime U2 R DPrime RPrime U2 RPrime",
      // 48
      "20112011": "RPrime U2 R2 U RPrime U R U2 BPrime RPrime B",
      // 49
      "10000121": "R U BPrime UPrime RPrime U R B RPrime",
      // 50
      "11000021": "RPrime UPrime F U R UPrime RPrime FPrime R",
      // 51
      "01100120": "L FPrime LPrime UPrime L U F UPrime LPrime",
      // 52
      "11112020": "RPrime F R2 FPrime U2 FPrime U2 F RPrime",
      // 53
      "20110100": "BPrime RPrime B LPrime BPrime R R BPrime RPrime B2 L",
      // 54
      "20100101": "B L BPrime R B L2 B L B2 RPrime",
      // 55
      "01101011": "FPrime UPrime F L FPrime LPrime U L F LPrime",
      // 56
      "21012020": "F U FPrime RPrime F R UPrime RPrime FPrime R"
      // 57
    };
  }
  isSolved() {
    return this.getOllString() === SOLVED_STATE2;
  }
  solve() {
    return this._solve();
  }
  _getCaseNumber() {
    return this.getOllString();
  }
  _solveCase(ollString) {
    let pattern = this.findPattern(ollString);
    let algorithm = this.getAlgorithm(pattern);
    let frontFace = this._getFrontFace(ollString, pattern);
    this.move(algorithm, {
      orientation: { up: "down", front: frontFace }
    });
  }
  getOllString() {
    let orientations = [];
    let cubies = this._getOllCubies();
    cubies.forEach((cubie) => {
      let orientation = this._getCubieOrientation(cubie);
      orientations.push(orientation);
    });
    return orientations.join("");
  }
  /**
   * @param {string} [ollString] - Probably unnecessary. If passed in, it saves
   * a step computing the ollString.
   */
  findPattern(ollString) {
    if (typeof ollString === "undefined") {
      ollString = this.getOllString();
    }
    for (let i = 0; i < 4; i++) {
      let algorithm = this.algorithms[ollString];
      if (typeof algorithm === "string") {
        return ollString;
      } else {
        ollString = this._rotateOllStringLeft(ollString);
      }
    }
    throw new Error(`No pattern found for oll string "${ollString}"`);
  }
  /**
   * @param {string} [pattern] - The pattern on this OLL or the ollString.
   */
  getAlgorithm(pattern) {
    if (typeof pattern === "undefined") {
      pattern = this.getPattern(pattern);
    }
    if (typeof this.algorithms[pattern] === "undefined") {
      throw new Error(`No algorithm found for pattern "${pattern}"`);
    }
    return this.algorithms[pattern];
  }
  _getOllCubies() {
    let positions = [
      ["front", "down", "right"],
      ["front", "down"],
      ["front", "down", "left"],
      ["left", "down"],
      ["left", "down", "back"],
      ["back", "down"],
      ["back", "down", "right"],
      ["right", "down"]
    ];
    return positions.map((pos) => this.cube.getCubie(pos));
  }
  /**
   * Returns a number indicating the orientation of the cubie.
   * 0 --> The DOWN color is on the DOWN face.
   * 1 --> The DOWN color is a clockwise rotation from "solved".
   * 2 --> The DOWN color is a counter-clockwise rotation from "solved".
   */
  _getCubieOrientation(cubie) {
    if (cubie.getColorOfFace("down") === "d") {
      return 0;
    }
    if (cubie.isEdge()) {
      return 1;
    }
    let [face1, face2] = cubie.faces().filter((face) => face !== "down");
    let dir = getDirectionFromFaces(face1, face2, { up: "down" });
    let rightFace = dir === "right" ? face2 : face1;
    return cubie.getColorOfFace(rightFace) === "d" ? 1 : 2;
  }
  _getFrontFace(ollString, pattern) {
    let rotationOrder = ["front", "left", "back", "right"];
    for (let i = 0; i < 4; i++) {
      if (ollString === pattern) {
        return rotationOrder[i];
      } else {
        ollString = this._rotateOllStringLeft(ollString);
      }
    }
    throw new Error(`OLL string "${ollString}" does not resolve to the pattern "${pattern}"`);
  }
  _rotateOllStringLeft(ollString) {
    return ollString.slice(2) + ollString.slice(0, 2);
  }
  _getPartitionBefore() {
    return this.getOllString();
  }
  _getPartitionAfter() {
    return null;
  }
};

// upstream/src/solvers/pll/index.js
var SOLVED_STATE3 = "0 0 0 0 0 0 0 0";
var PLLSolver = class extends BaseSolver {
  constructor(...args) {
    super(...args);
    this.phase = "pll";
    this.algorithms = {
      [SOLVED_STATE3]: "",
      // already solved
      "2 -1 1 -1 1 0 0 2": "R2 F2 RPrime BPrime R F2 RPrime B RPrime",
      // #1
      "-1 1 -1 2 2 0 0 1": "R BPrime R F2 RPrime B R F2 R2",
      // #2
      "1 -1 2 2 0 0 1 -1": "R UPrime R U R U R UPrime RPrime UPrime R2",
      // #3
      "-1 1 -1 1 0 0 2 2": "R2 U R U RPrime UPrime RPrime UPrime RPrime U RPrime",
      // #4
      "2 2 2 2 2 2 2 2": "M M U M M U2 M M U M M",
      // #5
      "0 1 1 1 1 0 2 2": "R U RPrime UPrime RPrime F R2 UPrime RPrime UPrime R U RPrime FPrime",
      // #6
      "1 0 2 0 1 0 0 0": "R U2 RPrime UPrime R U2 LPrime U RPrime UPrime L",
      // #7
      "0 2 2 0 1 1 1 1": "F R UPrime RPrime UPrime R U RPrime FPrime R U RPrime UPrime RPrime F R FPrime",
      // #8
      "1 -1 -1 2 -1 -1 1 0": "RPrime U2 R U2 RPrime F R U RPrime UPrime RPrime FPrime R2",
      // #9
      "0 1 -1 -1 2 -1 -1 1": "R UPrime RPrime UPrime R U R D RPrime UPrime R DPrime RPrime U2 RPrime",
      // #10
      "0 2 -1 -1 -1 -1 2 0": "RPrime U RPrime UPrime BPrime D BPrime DPrime B2 RPrime BPrime R B R",
      // #11
      "2 -1 -1 -1 -1 2 0 0": "RPrime UPrime FPrime R U RPrime UPrime RPrime F R2 UPrime RPrime UPrime R U RPrime U R",
      // #12
      "-1 2 2 2 -1 2 0 2": "L U LPrime B2 uPrime B UPrime BPrime U BPrime u B2",
      // #13
      "2 -1 2 0 2 -1 2 2": "RPrime UPrime R B2 u BPrime U B UPrime B uPrime B2",
      // #14
      "2 -1 1 1 0 1 1 -1": "R2 uPrime R UPrime R U RPrime u R2 B UPrime BPrime",
      // #15
      "1 0 1 1 -1 2 -1 1": "R2 u RPrime U RPrime UPrime R uPrime R2 FPrime U F",
      // #16
      "1 -1 -1 1 1 -1 -1 1": "U RPrime UPrime R UPrime R U R UPrime RPrime U R U R2 UPrime RPrime",
      // #17
      "0 1 0 0 0 1 0 2": "LPrime U2 L U LPrime U2 R UPrime L U RPrime",
      // #18
      "1 1 -1 -1 1 1 -1 -1": "R BPrime RPrime F R B RPrime FPrime R B RPrime F R BPrime RPrime FPrime",
      // #19
      "2 0 2 0 2 0 2 0": "R U RPrime U R U RPrime FPrime R U RPrime UPrime RPrime F R2 UPrime RPrime U2 R UPrime RPrime",
      // #20
      "0 2 0 2 0 2 0 2": "RPrime U R UPrime RPrime FPrime UPrime F R U RPrime F RPrime FPrime R UPrime R"
      // #21
    };
  }
  solve() {
    return this._solve();
  }
  _getCaseNumber() {
    return this.getPllString();
  }
  _solveCase(pllString) {
    let pattern = this.findPattern(pllString);
    let algorithm = this.getAlgorithm(pattern);
    let frontFace = this._getFrontFace(pllString, pattern);
    this.move(algorithm, {
      orientation: { up: "down", front: frontFace }
    });
    let cubie = this.cube.getCubie(["down", "front"]);
    let origin = "front";
    let target = getFaceOfMove(cubie.getColorOfFace(origin));
    let lastLayerMove = getRotationFromTo("down", origin, target);
    this.move(lastLayerMove);
  }
  isSolved() {
    return this.cube.isSolved();
  }
  /**
   * Permutations are unique in the way that each cubie is permutated relative
   * to the one adjacent to it. For each cubie (in order), find the relative
   * direction from its color to the next cubie's color, and turn it into a
   * number. This will allow each permutation to be held in a unique string.
   */
  getPllString() {
    let pllString = [];
    let pllCubies = this._getPllCubies();
    let faces = ["front", "left", "back", "right"];
    for (let i = 0; i < pllCubies.length; i++) {
      let cubie1 = pllCubies[i];
      let cubie2 = pllCubies[i + 1];
      let faceToCheck = faces[~~(i / 2)];
      let color1 = cubie1.getColorOfFace(faceToCheck);
      if (!cubie2) {
        cubie2 = pllCubies[0];
      }
      let color2 = cubie2.getColorOfFace(faceToCheck);
      let face1 = getFaceOfMove(color1);
      let face2 = getFaceOfMove(color2);
      let direction = getDirectionFromFaces(face1, face2, { up: "down" });
      if (direction === "front") direction = 0;
      if (direction === "right") direction = 1;
      if (direction === "left") direction = -1;
      if (direction === "back") direction = 2;
      pllString.push(direction);
    }
    return pllString.join(" ");
  }
  findPattern(pllString) {
    let initialString = pllString;
    if (typeof pllString === "undefined") {
      pllString = this.getPllString();
    }
    for (let i = 0; i < 4; i++) {
      let algorithm = this.algorithms[pllString];
      if (typeof algorithm === "string") {
        return pllString;
      } else {
        pllString = this._rotatePllStringLeft(pllString);
      }
    }
    throw new Error(`No pattern found for pll string "${initialString}"`);
  }
  getAlgorithm(pattern) {
    if (typeof pattern === "undefined") {
      pattern = this.findPattern(pattern);
    }
    if (typeof this.algorithms[pattern] === "undefined") {
      throw new Error(`No algorithm found for pattern "${pattern}"`);
    }
    return this.algorithms[pattern];
  }
  _getPllCubies() {
    let positions = [
      ["front", "down", "right"],
      ["front", "down"],
      ["front", "down", "left"],
      ["left", "down"],
      ["left", "down", "back"],
      ["back", "down"],
      ["back", "down", "right"],
      ["right", "down"]
    ];
    return positions.map((pos) => this.cube.getCubie(pos));
  }
  _getCubiePermutation(cubie) {
    let face = cubie.faces().find((face2) => face2 !== "down");
    let cubeFace = getFaceOfMove(cubie.getColorOfFace(face));
    let moveToSolveCubie = getRotationFromTo("down", face, cubeFace);
    moveToSolveCubie = moveToSolveCubie.toLowerCase();
    let dir;
    if (moveToSolveCubie === "") dir = 0;
    else if (moveToSolveCubie.includes("prime")) dir = 1;
    else if (moveToSolveCubie.split(" ").length > 1) dir = 2;
    else dir = -1;
    return dir;
  }
  _rotatePllStringLeft(pllString) {
    let arr = pllString.split(" ").map((num) => parseInt(num));
    return [...arr.slice(2), ...arr.slice(0, 2)].join(" ");
  }
  _getFrontFace(pllString, pattern) {
    let rotationOrder = ["front", "left", "back", "right"];
    for (let i = 0; i < 4; i++) {
      if (pllString === pattern) {
        return rotationOrder[i];
      } else {
        pllString = this._rotatePllStringLeft(pllString);
      }
    }
    throw new Error(`OLL string "${pllString}" does not resolve to the pattern "${pattern}"`);
  }
};

// upstream/src/Solver.js
var Solver = class {
  /**
   * @param {string|RubiksCube} cubeState - Can be one of 3 things:
   * 1) A string representing a Rubik's Cube state.
   * 2) A string containing a list of moves to make from a solved state to
   *    identify a cube state.
   * 3) An instance of a RubiksCube.
   */
  constructor(cubeState, options) {
    if (cubeState instanceof RubiksCube) {
      this.cube = cubeState;
    } else if (typeof cubeState === "string") {
      let magicNum = 6;
      if (cubeState.split(" ").length > 1 || cubeState.length <= magicNum) {
        this.cube = RubiksCube.Solved();
        this.cube.move(cubeState);
      } else {
        this.cube = new RubiksCube(cubeState);
      }
    } else {
      throw new Error('"cubeState" is not a valid cubeState. Please provide a list of scramble moves or a string representing a cube state');
    }
    this.options = options;
    this.phases = ["cross", "f2l", "oll", "pll"];
    this.progress = {};
    this.phases.forEach((phase) => this.progress[phase] = []);
    const afterEach = (partition, phase) => {
      this._updateProgress(partition, phase);
    };
    this.currentPhase = null;
    this.currentSolver = null;
    this.crossSolver = new CrossSolver(this.cube, this.options);
    this.f2lSolver = new F2LSolver(this.cube, this.options);
    this.ollSolver = new OLLSolver(this.cube, this.options);
    this.pllSolver = new PLLSolver(this.cube, this.options);
    this.afterEach("all", afterEach);
  }
  afterEach(phases, callback) {
    if (typeof phases === "function") {
      callback = phases;
      phases = "all";
    } else if (typeof phases === "string") {
      if (phases === "all") {
        phases = this.phases.slice();
      } else {
        phases = [phases];
      }
    }
    if (typeof callback !== "function") {
      throw new Error('"afterEach" callback is not a function.');
    }
    for (let phase of phases) {
      if (!this.phases.includes(phase)) {
        throw new Error(`Phase "${phase}" isn't recognized. Please specify "cross", "f2l", "oll", "pll", or "all".`);
      }
    }
    for (let phase of phases) {
      let solver = this[`${phase}Solver`];
      solver.afterEach(callback);
    }
  }
  solve() {
    this.currentPhase = "cross";
    this.currentSolver = this.crossSolver;
    this.crossSolver.solve();
    this.currentPhase = "f2l";
    this.currentSolver = this.f2lSolver;
    this.f2lSolver.solve();
    this.currentPhase = "oll";
    this.currentSolver = this.ollSolver;
    this.ollSolver.solve();
    this.currentPhase = "pll";
    this.currentSolver = this.pllSolver;
    this.pllSolver.solve();
  }
  getMoves() {
    let moves2 = [];
    Object.keys(this.progress).forEach((phase) => {
      let partitions = this.progress[phase];
      partitions.forEach((partition) => moves2.push(...partition.moves));
    });
    moves2 = normalizeNotations(moves2);
    return moves2.join(" ");
  }
  getPartitions() {
    let ret = {};
    let phases = Object.keys(this.progress);
    phases.forEach((phase) => {
      let partitions = this.progress[phase];
      if (partitions.length === 1) {
        ret[phase] = algorithmShortener(partitions[0].moves);
      } else {
        let phaseMoves = [];
        this.progress[phase].forEach((partition) => {
          phaseMoves.push(algorithmShortener(partition.moves));
        });
        ret[phase] = phaseMoves;
      }
    });
    return ret;
  }
  isCrossEdgeSolved(edge) {
    return this.crossSolver.isEdgeSolved(edge);
  }
  isF2LPairSolved({ corner, edge }) {
    return this.f2lSolver.isPairSolved({ corner, edge });
  }
  isOLLSolved() {
    return this.ollSolver.isSolved();
  }
  isPLLSolved() {
    return this.pllSolver.isSolved();
  }
  _updateProgress(partition, phase) {
    this.progress[phase].push(partition);
  }
};

// upstream/src/index.js
var index_default = (cubeState, options = {}) => {
  let solver = new Solver(cubeState, options);
  solver.solve();
  if (options.partitioned) {
    return solver.getPartitions();
  } else {
    return algorithmShortener(solver.getMoves());
  }
};
export {
  CrossSolver,
  Cubie,
  F2LSolver,
  OLLSolver,
  PLLSolver,
  RubiksCube,
  Solver,
  algorithmShortener,
  index_default as default
};
