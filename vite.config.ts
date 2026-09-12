import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * 管理画面のビルド。**Worker とは別のビルド**で、成果物は静的アセットとして配る。
 *
 * `base: './'` にしてあるので、`<mount>/admin/` がどこにマウントされても
 * 動く。mountPath は deployment の設定なので、ここに焼き付けない。
 */
export default defineConfig({
  root: 'src/admin',
  base: './',
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: true,
  },
  plugins: [vue()],
});
