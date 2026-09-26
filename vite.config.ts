import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Library build. Everything a host application also uses stays external so a
 * consumer never ends up with two copies of three.js in one bundle.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "SymAWEViewer.js",
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "three",
        "@react-three/fiber",
        "@react-three/drei",
        "apache-arrow",
        /^@noble\/hashes/,
      ],
    },
  },
});
