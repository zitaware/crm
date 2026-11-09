import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Dates and times are typed through a mask (DD/MM/YYYY, HH:mm): take the pickers from the shared component.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/masked-date-picker.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "antd",
              importNames: ["DatePicker", "TimePicker"],
              message: "Use DatePicker / TimePicker from '@/components/masked-date-picker' so the date is typed as DD/MM/YYYY.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
