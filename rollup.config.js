import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

export default {
    input: 'src/app.ts',
    output: {
        file: 'dist/app.js',
        format: 'esm',
        sourcemap: false
    },
    // Mark ALL dependencies as external to avoid bundling them (standard for Node.js)
    external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        'path', 'fs', 'url', 'dotenv/config'
    ],
    onwarn: (warning) => {
        if (warning.code === 'UNRESOLVED_IMPORT') return
    },
    plugins: [
        resolve({
            extensions: ['.ts', '.js']
        }),
        typescript({
            tsconfig: './tsconfig.json',
            compilerOptions: {
                moduleResolution: 'node'
            }
        }),
        commonjs(),
        json()
    ],
}
