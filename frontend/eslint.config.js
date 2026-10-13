/**
 * ESLint flat config — TypeScript + React 项目通用规则
 * 仅启用正确性/ hooks 依赖相关规则，不做风格类强制（风格交给 Prettier）
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  // 构建产物与虚拟模块不参与检查
  { ignores: ['dist', 'node_modules', 'src/virtual-pwa-register.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React hooks 依赖正确性检查（性能与正确性双重保障）
      ...reactHooks.configs.recommended.rules,
      // HMR 边界约束：非组件导出仅警告，不阻塞
      'react-refresh/only-export-components': 'warn',
      // 未使用变量：允许下划线前缀占位
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // 存量代码 any 较多，首轮不强制
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
