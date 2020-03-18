import svelte from 'rollup-plugin-svelte'
import postcss from 'rollup-plugin-postcss'
import resolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import svg from 'rollup-plugin-svg'
import { terser } from 'rollup-plugin-terser'

const production = !process.env.ROLLUP_WATCH

export default {
  input: 'index.js',
  output: {
    sourcemap: !production,
    format: 'iife',
    name: 'wte',
    file: '../static/app.js'
  },
  external: [],
  plugins: [
    svg(),
    svelte({
      dev: !production,
      css: (css) => css.write('../static/app.css', false)
    }),
    postcss(),
    resolve({ browser: true }),
    commonjs(),
    production && terser()
  ]
}
