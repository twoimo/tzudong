/*global navigator*/
'use strict';

const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

const isLineTerminator = ch => ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';

// Keep a bracket class intact and drop other escapes, without a backtracking scan.
exports.removeBackslashes = str => {
  let out = '';
  let i = 0;
  const n = str.length;
  while (i < n) {
    if (str[i] === '[') {
      let j = i + 1;
      let end = -1;
      let limit = n;
      while (j < n) {
        if (isLineTerminator(str[j])) {
          if (j + 1 < n && str[j + 1] === ']') end = j + 1;
          else limit = j;
          break;
        }
        if (j >= i + 2 && str[j] === ']' && str[j - 1] !== '\\') {
          end = j;
          break;
        }
        j += 1;
      }
      if (end !== -1) {
        out += str.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      while (i < limit) {
        if (str[i] === '\\' && i + 1 < n && !isLineTerminator(str[i + 1])) {
          i += 1;
          continue;
        }
        out += str[i];
        i += 1;
      }
      continue;
    }
    if (str[i] === '\\' && i + 1 < n && !isLineTerminator(str[i + 1])) {
      i += 1;
      continue;
    }
    out += str[i];
    i += 1;
  }
  return out;
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
