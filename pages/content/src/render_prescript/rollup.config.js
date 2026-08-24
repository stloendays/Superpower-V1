import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser'; // Note: Deprecated, but using for broader compatibility

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'iife', // Immediately Invoked Function Expression - suitable for browser script tags
    name: 'FunctionCallRenderer', // Optional: a global variable name if needed, though we mainly use window assignments
    sourcemap: false, // Keep false for direct console use, true for debugging
  },
  plugins: [
    resolve({ browser: true }), // Resolve bare module specifiers in node_modules
    commonjs(), // Convert CommonJS modules to ES6
    typescript({
      tsconfig: './tsconfig.json',
      compilerOptions: {
        // Ensure output is compatible with browsers targeted by IIFE
        target: 'ES2015', // A safe target for wide browser compatibility
        declaration: false, // No need for declaration files in the bundle
        declarationDir: undefined,
      },
    }), // Compile TypeScript
    terser(), // Minify the output bundle
  ],
};
