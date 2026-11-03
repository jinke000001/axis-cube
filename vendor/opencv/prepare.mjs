// Reproduce the small CSP/ES-module adapter from the unmodified official build.
// Usage: node vendor/opencv/prepare.mjs /path/to/opencv-4.13.0/js/bin/opencv.js
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const original = readFileSync(process.argv[2], "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const expected =
  "63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0";
if (hash(original) !== expected)
  throw new Error(
    "Unexpected upstream bytes; review the adapter before updating OpenCV.",
  );
let adapted = original;
const replaceSection = (start, end, replacement) => {
  const a = adapted.indexOf(start),
    b = adapted.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error("Missing upstream adapter marker");
  adapted = adapted.slice(0, a) + replacement + adapted.slice(b);
};
replaceSection(
  "function createNamedFunction(name,body){",
  "function extendError(",
  'function createNamedFunction(name,body){var named=function(){return body.apply(this,arguments)};Object.defineProperty(named,"name",{value:makeLegalFunctionName(name)});return named}',
);
replaceSection(
  "function makeDynCaller(dynCall){",
  "var fp;",
  "function makeDynCaller(dynCall){return function(){return dynCall.apply(null,[rawFunction].concat(Array.prototype.slice.call(arguments)))}}",
);
replaceSection(
  "function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){",
  "function heap32VectorToArray(",
  'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2)throwBindingError("argTypes array size mismatch! Must at least get return value and this types!");var isClassMethod=argTypes[1]!==null&&classType!==null;var needsStack=argTypes.slice(1).some(function(t){return t!==null&&t.destructorFunction===undefined});var fn=createNamedFunction(humanName,function(){if(arguments.length!==argCount-2)throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+(argCount-2)+" args!");var destructors=needsStack?[]:null;var wired=[cppTargetFunc];if(isClassMethod)wired.push(argTypes[1].toWireType(destructors,this));for(var i=0;i<arguments.length;i++)wired.push(argTypes[i+2].toWireType(destructors,arguments[i]));var rv=cppInvokerFunc.apply(null,wired);if(needsStack)runDestructors(destructors);else for(var i=isClassMethod?1:2;i<argTypes.length;i++)if(argTypes[i].destructorFunction!==null)argTypes[i].destructorFunction(wired[i-(isClassMethod?0:1)]);if(argTypes[0].name!=="void")return argTypes[0].fromWireType(rv)});Object.defineProperty(fn,"length",{value:argCount-2});return fn}',
);
replaceSection(
  "function __emval_get_method_caller(argCount,argTypes){",
  "function __emval_get_property(",
  "function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];return __emval_addMethodCaller(function(handle,name,destructors,args){var values=[],offset=0;for(var i=1;i<argCount;i++){values.push(types[i].readValueFromPointer(args+offset));offset+=types[i].argPackAdvance}var rv=handle[name].apply(handle,values);for(var i=1;i<argCount;i++)if(types[i].deleteObject)types[i].deleteObject(values[i-1]);if(!retType.isVoid)return retType.toWireType(destructors,rv)})}",
);
adapted = adapted.replace(
  "}(this, function () {",
  "}(globalThis, function () {",
);
adapted = adapted.replace(
  "if (typeof Module === 'undefined')\n    Module = {};",
  "var Module = {};",
);
if (/new Function|new_\(Function|\beval\s*\(/.test(adapted))
  throw new Error("Dynamic JS execution remains");
writeFileSync("public/vendor/opencv/opencv-4.13.0.js", adapted);
console.log(
  JSON.stringify(
    {
      originalSha256: hash(original),
      adaptedSha256: hash(adapted),
      bytes: adapted.length,
    },
    null,
    2,
  ),
);
