import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, ".", "");
    return {
        plugins: [react()],
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        server: {
            port: 3000,
            proxy: {
                "/api": {
                    target: env.VITE_API_PROXY_TARGET || "http://localhost:3001",
                    changeOrigin: true,
                },
            },
        },
    };
});
