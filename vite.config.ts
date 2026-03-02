/// <reference types="vitest" />
import {defineConfig} from "vitest/config";
import dts from "vite-plugin-dts";

export default defineConfig({
    build: {
        lib: {
            entry: "src/index.ts",
            formats: ["es", "cjs"],
            fileName: (format) => format === "es" ? "index.es" : "index.cjs"
        },
        rollupOptions: {
            external: [/^node:/]
        },
        sourcemap: true,
        target: "node18"
    },
    plugins: [dts()],
    test: {
        environment: "node"
    }
});
